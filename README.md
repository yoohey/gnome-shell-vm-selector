# VM Selector

A GNOME Shell extension that lets you pick a KVM (libvirt) virtual machine from the top bar and connect to it fullscreen.

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

## Known limitations

- Only tested on NixOS so far. Commands are looked up in `PATH`, so Fedora, Ubuntu, etc. should work too, but this is not verified yet.
- The connection URI is fixed to `qemu:///system`.
- If you are not in the `libvirt` (or `libvirtd`) group, the extension does not poll in the background (virsh would ask for a password every 5 seconds). The top bar shows `VM !` and the menu explains what to do; "Try anyway" makes a single query.
- The panel and menu text is English only.

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

## License

MIT (see `LICENSE`).
