import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Commands are called by name only (Gio.Subprocess searches PATH), so it works on NixOS, Fedora, Ubuntu, etc.
const VIRSH = ['virsh', '-c', 'qemu:///system'];

// Run a command asynchronously as an argv array and return its stdout (null on failure).
// No shell is involved, so spaces or quotes in a VM name cannot break it, and the Shell main loop is never blocked.
async function runCapture(argv) {
    try {
        const proc = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.init(null);
        // GJS's communicate_utf8_finish returns an [ok, stdout, stderr] tuple
        const [, stdout] = await new Promise((resolve, reject) => {
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    resolve(p.communicate_utf8_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
        return proc.get_successful() ? stdout : null;
    } catch (e) {
        return null;
    }
}

// Is the user in a group that may manage qemu:///system? Without it, every virsh call makes polkit ask for a
// password, so we must not poll in the background. (Debian-family older releases call the group "libvirtd".)
async function hasLibvirtAccess() {
    const out = await runCapture(['id', '-Gn']);
    if (out === null) return true; // cannot tell: behave as before
    const groups = out.trim().split(/\s+/);
    return groups.includes('libvirt') || groups.includes('libvirtd') || groups.includes('root');
}

function spawnDetached(argv) {
    try {
        new Gio.Subprocess({ argv, flags: Gio.SubprocessFlags.NONE }).init(null);
    } catch (e) {
        console.error('VM Selector spawn error:', e);
    }
}

// Returns the list of VMs, or null when virsh failed (e.g. no permission), so callers can tell
// "no VMs" from "could not ask".
async function getVmList() {
    const out = await runCapture([...VIRSH, 'list', '--all', '--name']);
    if (out === null) return null;
    const names = out.split('\n').map(s => s.trim()).filter(s => s);
    return Promise.all(names.map(async name => {
        const state = await runCapture([...VIRSH, 'domstate', name]);
        return { name, state: (state || '').trim() };
    }));
}

function runVirsh(args) {
    spawnDetached([...VIRSH, ...args]);
}

function openViewer(name, extraArgs = []) {
    spawnDetached(['virt-viewer', '-c', 'qemu:///system', '-f', ...extraArgs, name]);
}

function focusExistingVmWindow(name) {
    try {
        const windowActors = global.get_window_actors();
        for (const actor of windowActors) {
            const win = actor.get_meta_window();
            if (!win) continue;

            const wmClass = (win.get_wm_class() || '').toLowerCase();
            const title = (win.get_title() || '').toLowerCase();
            const targetName = name.toLowerCase();

            // A virt-viewer window whose title contains the VM name
            if (wmClass.includes('virt-viewer') && title.includes(targetName)) {
                const workspace = win.get_workspace();
                const now = global.get_current_time();
                if (workspace && workspace !== global.workspace_manager.get_active_workspace()) {
                    workspace.activate(now);
                }
                win.activate(now);
                return true;
            }
        }
    } catch (e) {
        console.error('VM Selector focus error:', e);
    }
    return false;
}

function launchOrFocusVm(name, state) {
    const isRunning = state.includes('running');
    const isPaused = state.includes('paused');
    if (isRunning || isPaused) {
        // If paused, resume first
        if (isPaused) runVirsh(['resume', name]);
        // If a window already exists, focus it (stays fullscreen or windowed as it was)
        if (focusExistingVmWindow(name)) return;
        // Otherwise open it fullscreen
        openViewer(name);
    } else {
        // If stopped, start it and connect (-w: wait until the VM is up)
        runVirsh(['start', name]);
        openViewer(name, ['-w']);
    }
}

const VmIndicator = GObject.registerClass(
class VmIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'VM Selector');

        this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this._label = new St.Label({
            text: 'VM ...',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'vm-selector-label',
        });
        this._box.add_child(this._label);
        this.add_child(this._box);

        this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                this._refresh();
            }
        });

        this._destroyed = false;
        this._seq = 0;
        this._timeoutIds = new Set();
        this._access = false; // set by the first check; no background virsh until we know

        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._updateCountsOnly();
            return GLib.SOURCE_CONTINUE;
        });
        this._init2();
    }

    async _init2() {
        const ok = await hasLibvirtAccess();
        if (this._destroyed) return;
        this._access = ok;
        this._refresh();
    }

    async _updateCountsOnly() {
        if (this.menu.isOpen || !this._access) return;
        try {
            const vms = await getVmList();
            if (this._destroyed || vms === null) return;
            const runningCount = vms.filter(v => v.state.toLowerCase().includes('running')).length;
            this._label.set_text(`VM ${runningCount}/${vms.length}`);
        } catch (e) {
            console.error('VM Selector updateCounts error:', e);
        }
    }

    _showNoAccess() {
        this._label.set_text('VM !');
        this.menu.removeAll();
        const msg = new PopupMenu.PopupMenuItem(
            'You are not in the "libvirt" group, so virsh would ask for a password every time.', { reactive: false });
        msg.label.style_class = 'vm-header-label';
        this.menu.addMenuItem(msg);
        const hint = new PopupMenu.PopupMenuItem(
            'Run: sudo usermod -aG libvirt $USER   then log out and in again.', { reactive: false });
        hint.label.style_class = 'vm-header-label';
        this.menu.addMenuItem(hint);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const tryItem = new PopupMenu.PopupMenuItem('Try anyway (may ask for a password)');
        // One query only; polling starts only if it actually returns VMs
        tryItem.connect('activate', () => this._refresh(true));
        this.menu.addMenuItem(tryItem);
    }

    async _refresh(force = false) {
        if (!this._access && !force) {
            this._showNoAccess();
            return;
        }
        const seq = ++this._seq;
        try {
            let vms = await getVmList();
            // Discard if destroyed, or if a newer refresh has started
            if (this._destroyed || seq !== this._seq) return;
            if (vms === null) {
                // virsh failed. For a forced single try, keep showing the no-access help; otherwise show an empty list.
                if (force) { this._showNoAccess(); return; }
                vms = [];
            } else if (force) {
                this._access = true; // it worked (even with 0 VMs), so start normal polling
            }
            this.menu.removeAll();

            const runningCount = vms.filter(v => v.state.toLowerCase().includes('running')).length;
            this._label.set_text(`VM ${runningCount}/${vms.length}`);

            const header = new PopupMenu.PopupMenuItem('Virtual machines (KVM) - left click: screen / right click: power', { reactive: false });
            header.label.style_class = 'vm-header-label';
            this.menu.addMenuItem(header);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            if (vms.length === 0) {
                const item = new PopupMenu.PopupMenuItem('No virtual machines', { reactive: false });
                this.menu.addMenuItem(item);
            } else {
            for (const vm of vms) {
                const stateLower = vm.state.toLowerCase();
                const isRunning = stateLower.includes('running');
                const isPaused = stateLower.includes('paused');

                let icon = '○';
                let stateText = '[stopped]';
                let stateStyle = 'vm-stopped-item';

                if (isRunning) {
                    icon = '●';
                    stateText = '[running]';
                    stateStyle = 'vm-running-item';
                } else if (isPaused) {
                    icon = '⏸';
                    stateText = '[paused]';
                    stateStyle = 'vm-paused-item';
                }

                // Main item for the VM
                const vmItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
                const itemBox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });

                const nameLabel = new St.Label({
                    text: `${icon}  ${vm.name}   ${stateText}`,
                    x_expand: true,
                    style_class: stateStyle,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                itemBox.add_child(nameLabel);
                vmItem.add_child(itemBox);

                // Container for the sub-actions (power operations)
                const subItem = new PopupMenu.PopupBaseMenuItem({
                    reactive: false,
                    can_focus: false,
                    style_class: 'vm-subaction-container',
                });
                subItem.actor.visible = false;

                const subBox = new St.BoxLayout({ style_class: 'vm-subaction-box' });

                const toggleSubmenu = () => {
                    subItem.actor.visible = !subItem.actor.visible;
                };

                // Helper to create a button for a power action
                const addActionButton = (label, actionArgs) => {
                    const btn = new St.Button({
                        label: label,
                        style_class: 'vm-subaction-btn',
                        can_focus: true,
                    });
                    btn.connect('clicked', () => {
                        runVirsh(actionArgs);
                        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                            this._timeoutIds.delete(id);
                            this._refresh();
                            return GLib.SOURCE_REMOVE;
                        });
                        this._timeoutIds.add(id);
                    });
                    subBox.add_child(btn);
                };

                if (isRunning) {
                    addActionButton('⏸ Pause', ['suspend', vm.name]);
                    addActionButton('⏹ Shut down', ['shutdown', vm.name]);
                    addActionButton('⚡ Force off', ['destroy', vm.name]);
                } else if (isPaused) {
                    addActionButton('▶ Resume', ['resume', vm.name]);
                    addActionButton('⚡ Force off', ['destroy', vm.name]);
                } else {
                    addActionButton('▶ Start (no screen)', ['start', vm.name]);
                }

                subItem.add_child(subBox);

                // Click handling
                // Left click: connect to the screen / focus it
                // Right click: toggle the power sub-menu
                vmItem.connect('button-press-event', (actor, event) => {
                    const button = event.get_button();
                    if (button === 1) { // Left click
                        launchOrFocusVm(vm.name, stateLower);
                        this.menu.close();
                        return Clutter.EVENT_STOP;
                    } else if (button === 3) { // Right click
                        toggleSubmenu();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                this.menu.addMenuItem(vmItem);
                this.menu.addMenuItem(subItem);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const mgrItem = new PopupMenu.PopupMenuItem('⚙️  Open Virtual Machine Manager');
        mgrItem.connect('activate', () => {
            spawnDetached(['virt-manager']);
        });
        this.menu.addMenuItem(mgrItem);
        } catch (e) {
            console.error('VM Selector refresh error:', e);
        }
    }

    destroy() {
        this._destroy();
    }

    _destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = null;
        }
        for (const id of this._timeoutIds) GLib.source_remove(id);
        this._timeoutIds.clear();
        super.destroy();
    }
});

export default class VmSelectorExtension extends Extension {
    enable() {
        this._indicator = new VmIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
    }

    disable() {
        if (this._indicator) {
            this._indicator._destroy();
            this._indicator = null;
        }
    }
}
