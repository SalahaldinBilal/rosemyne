# rosemyne-plugin

Write, build and pack [Rosemyne](https://github.com/SalahaldinBilal/rosemyne) plugins in Rust.

```toml
# Cargo.toml
[lib]
crate-type = ["cdylib"]

[dependencies]
rosemyne-plugin = "1"
```

```rust
use rosemyne_plugin::{export_hooks, host, json, CaptureSaved, HookResult};

fn saved(input: CaptureSaved) -> HookResult<()> {
    host::set_tags(Some(&json!({ "Seen": true })))
}

export_hooks! {
    on_capture_saved => saved,
}
```

Put a `plugin.json` next to `Cargo.toml`, [install the packer](#installing-the-packer) once, then run it in that folder:

```sh
rosemyne-plugin-pack
```

That writes the `.rosemyne-plugin` file you install in Rosemyne under Settings › Plugins.

## Installing the packer

The packer is a command that comes with this crate. Having `rosemyne-plugin` in your `Cargo.toml` is not enough to get it, because Cargo doesn't install commands from dependencies. Install it once per machine:

```sh
cargo install rosemyne-plugin
```

Or from a checkout of the Rosemyne repo:

```sh
cargo install --path plugin-sdk/rust
```

Either one puts `rosemyne-plugin-pack` in `~/.cargo/bin` (`%USERPROFILE%\.cargo\bin` on Windows), which rustup already has on your PATH. Run the same command again to update it.

Plugins are built for WebAssembly, so that target has to be installed too:

```sh
rustup target add wasm32-unknown-unknown
```

To try the packer without installing it, run it straight from the repo:

```sh
cargo run --release --manifest-path plugin-sdk/rust/Cargo.toml -- path/to/your-plugin
```

It is a plain command, not a Cargo subcommand, so it's `rosemyne-plugin-pack`, not `cargo rosemyne-plugin-pack`.

The manifest, hooks, host functions and view nodes are described in the [plugin guide](https://github.com/SalahaldinBilal/rosemyne/blob/main/plugin-sdk/README.md).

## Using the packer

```
rosemyne-plugin-pack [folder] [--no-build] [--out <file>]
```

Run in the plugin crate's folder, it:

1. runs `cargo build --release --target wasm32-unknown-unknown` and copies the result to `plugin.wasm`
2. checks `plugin.json` against the rules Rosemyne applies on install
3. writes `<id>-<version>.rosemyne-plugin` from `plugin.json`, `plugin.wasm` and `icon.png` if there is one

`--no-build` packs a `plugin.wasm` that is already there.

The same two steps from code are `rosemyne_plugin::pack::build_plugin` and `pack_plugin`.

## What is compiled where

The crate has two halves, picked by the target:

- For wasm: `host`, `export_hooks!` and the hook types. This is what ends up in a plugin.
- For your own machine: `manifest`, `tree` and, with the default `pack` feature, `pack` and the `rosemyne-plugin-pack` command. None of it is compiled into a plugin.

`ui` (the view node builders) is in both.
