# VM Selector

[日本語](README.ja.md)

A GNOME Shell extension that lets you pick a KVM (libvirt) virtual machine from the top bar and connect to it fullscreen.

![The VM list opened from the top bar](docs/menu.png)

- Shows `VM running/total` (for example `VM 1/3`) in the top bar, refreshed every 5 seconds.
- Click it to see the list of VMs.
  - **Left click**: connect to the VM's screen with `virt-viewer` (fullscreen).
    - A stopped VM is started first.
    - A paused VM is resumed first.
    - If a window for the VM is already open, it is brought to the front instead of opening a new one.
  - **Right click**: show power actions (pause, resume, shut down, force off, start).
- The last item of the list opens Virtual Machine Manager (`virt-manager`).

## Why

On GNOME with Wayland, keys such as Super and Alt+Tab can be captured by the host even while a `virt-manager` console has focus. A standalone SPICE client, `virt-viewer`, used fullscreen, passes keys to the VM much more reliably. This extension is a one-click launcher for `virt-viewer` from the top bar.

## Requirements

- GNOME Shell 50 (see `shell-version` in `metadata.json`; other versions are untested)
- libvirt (connects to `qemu:///system`) and `virsh`
- `virt-viewer` and `virt-manager`
- Your user must be able to manage `qemu:///system` (usually: member of the `libvirt` group)

Install the packages first:

| Distribution | Command | Status |
|---|---|---|
| Fedora | `sudo dnf install libvirt-client virt-viewer virt-manager` | tested (virsh was already present) |
| Ubuntu / Debian | `sudo apt install libvirt-clients libvirt-daemon-system virt-viewer virt-manager` | package names not tested |
| Arch | `sudo pacman -S libvirt virt-viewer virt-manager` | package names not tested |
| NixOS | `virtualisation.libvirtd.enable = true;` and `pkgs.virt-viewer`, `pkgs.virt-manager` | tested |

## Install (manual)

First make sure your user may manage libvirt, then log out and in again (otherwise the top bar shows `VM !`):

```bash
sudo usermod -aG libvirt $USER
```

Then:

```bash
git clone https://github.com/yoohey/gnome-shell-vm-selector.git
mkdir -p ~/.local/share/gnome-shell/extensions/vm-selector@yoohey
cp gnome-shell-vm-selector/{metadata.json,extension.js,stylesheet.css} \
   ~/.local/share/gnome-shell/extensions/vm-selector@yoohey/
```

Log out and log in again (once more, so GNOME Shell sees the new extension), then enable it:

```bash
gnome-extensions enable vm-selector@yoohey
```

## If you are not in the `libvirt` group

Without the group, every `virsh` call makes polkit ask for a password, so the extension does not poll in the background. The top bar shows `VM !` and the menu tells you what to do:

![The menu shown when the user is not in the libvirt group](docs/no-access.png)

- Run `sudo usermod -aG libvirt $USER` and log out and in again, or
- press **Try anyway** to make a single query. If it works (even with 0 VMs), normal polling starts.

## Troubleshooting

| Symptom | What to check |
|---|---|
| The top bar item does not appear | Did you log out and in after copying the files? `gnome-extensions info vm-selector@yoohey` should say `State: ACTIVE` (or `ENABLED`). |
| `VM !` | You are not in the `libvirt` group (see above). `id -Gn` shows your groups of the current session. |
| `VM 0/0` but you have VMs | The extension talks to `qemu:///system`. VMs created under `qemu:///session` (for example by GNOME Boxes) are not listed. Check with `virsh -c qemu:///system list --all`. |
| Clicking a VM does nothing | Is `virt-viewer` installed (`virt-viewer --version`)? |
| Anything else | Look at the Shell log: `journalctl --user -b \| grep -i vm-selector`, or run `journalctl -f -o cat /usr/bin/gnome-shell` and reproduce. |

## How it works

All commands are run asynchronously as argument arrays (no shell is involved), and are looked up in `PATH`:

| What | Command |
|---|---|
| List VMs | `virsh -c qemu:///system list --all --name` |
| State of a VM | `virsh -c qemu:///system domstate NAME` |
| Power actions | `virsh -c qemu:///system start / suspend / resume / shutdown / destroy NAME` |
| Connect | `virt-viewer -c qemu:///system -f NAME` (`-w` is added for a VM that is being started) |
| Open the manager | `virt-manager` |

Before polling, the extension checks that you are in the `libvirt` (or `libvirtd`) group (`id -Gn`).

## Known limitations

- Tested on NixOS (GNOME Shell 50.5) and Fedora Workstation (GNOME Shell 50.0). Commands are looked up in `PATH`, so other distributions such as Ubuntu should work too, but they are not verified.
- The connection URI is fixed to `qemu:///system`.
- The panel and menu text is English only.

## License

MIT (see `LICENSE`).
