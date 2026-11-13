use std::path::PathBuf;
use std::process::ExitCode;

use rosemyne_plugin::pack::{build_plugin, pack_plugin};

const USAGE: &str = "Usage: rosemyne-plugin-pack [folder] [--no-build] [--out <file>]

Builds the plugin crate in <folder> (default: the current one) into plugin.wasm, checks
plugin.json and writes <id>-<version>.rosemyne-plugin.

  --no-build   Pack the plugin.wasm that is already there
  --out <file> Where to write the package";

struct Options {
    folder: PathBuf,
    output: Option<PathBuf>,
    build: bool,
}

fn parse(mut args: impl Iterator<Item = String>) -> Result<Option<Options>, String> {
    let mut options = Options { folder: PathBuf::from("."), output: None, build: true };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => return Ok(None),
            "--no-build" => options.build = false,
            "--out" => options.output = Some(args.next().ok_or("--out needs a file")?.into()),
            option if option.starts_with('-') => return Err(format!("Unknown option {option}\n\n{USAGE}")),
            folder => options.folder = folder.into(),
        }
    }
    Ok(Some(options))
}

fn run() -> Result<(), String> {
    let Some(options) = parse(std::env::args().skip(1))? else {
        println!("{USAGE}");
        return Ok(());
    };
    if options.build {
        build_plugin(&options.folder)?;
    }
    let path = pack_plugin(&options.folder, options.output.as_deref())?;
    println!("Packed into {}", path.display());
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("rosemyne-plugin-pack: {message}");
            ExitCode::FAILURE
        }
    }
}
