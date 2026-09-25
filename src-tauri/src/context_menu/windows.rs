use super::{
    ContextMenuStatus, FILE_TITLE, IMPORT_ARG, TYPED_TITLES, Windows11MenuStatus, blocking, cmrs,
    registry,
};
use crate::HttpClientHandler;
use crate::capture::windows::is_windows_11;
use std::path::{Path, PathBuf};

const VERB_NAME: &str = "Rosemyne.Upload";
const ALL_FILES_SHELL: &str = r"Software\Classes\*\shell";
const FILE_ASSOC_ROOT: &str = r"Software\Classes\SystemFileAssociations";
const DEV_MODE_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock";
const DEV_MODE_VALUE: &str = "AllowDevelopmentWithoutDevLicense";

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|err| format!("Failed to locate Rosemyne's executable: {err}"))
}

fn developer_mode_enabled() -> bool {
    registry::machine_dword(DEV_MODE_KEY, DEV_MODE_VALUE) == Some(1)
}

/// (classic menu entry, Windows 11 menu entry)
fn current_state() -> (bool, bool) {
    let windows11_config = cmrs::read_config();
    let classic = classic_verbs_installed()
        || windows11_config.as_ref().is_some_and(cmrs::includes_classic_menu);
    (classic, windows11_config.is_some())
}

pub fn status() -> ContextMenuStatus {
    let (classic, windows11) = current_state();
    let on_windows_11 = is_windows_11();
    ContextMenuStatus {
        supported: true,
        enabled: classic,
        note: on_windows_11.then_some("On Windows 11 it's under \"Show more options\"."),
        windows11: on_windows_11.then(|| Windows11MenuStatus {
            enabled: windows11,
            developer_mode: developer_mode_enabled(),
            cmrs: cmrs::status(),
        }),
    }
}

pub async fn set_enabled(http: &HttpClientHandler, enabled: bool) -> Result<(), String> {
    let (_, windows11) = blocking(current_state).await?;
    apply(http, enabled, windows11).await
}

pub async fn set_windows11_enabled(http: &HttpClientHandler, enabled: bool) -> Result<(), String> {
    let (classic, _) = blocking(current_state).await?;
    apply(http, classic, enabled).await
}

/// With the Windows 11 entry on, cmrs also owns the classic one, so ours is removed.
async fn apply(http: &HttpClientHandler, classic: bool, modern: bool) -> Result<(), String> {
    let exe = current_exe()?;

    if modern {
        if !is_windows_11() {
            return Err("The new context menu is only available on Windows 11".into());
        }
        if !developer_mode_enabled() {
            return Err("Turn on Developer Mode in Windows Settings first".into());
        }
        cmrs::enable(http, &exe, classic).await?;
        return blocking(remove_classic_verbs).await;
    }

    if cmrs::config_exists() {
        cmrs::disable(http).await?;
    }
    blocking(move || {
        if classic {
            write_classic_verbs(&exe)
        } else {
            remove_classic_verbs();
            Ok(())
        }
    })
    .await?
}

pub async fn refresh(http: &HttpClientHandler) {
    let Ok(exe) = current_exe() else {
        return;
    };

    let classic_exe = exe.clone();
    let rewritten = blocking(move || {
        if classic_verbs_installed() {
            write_classic_verbs(&classic_exe)
        } else {
            Ok(())
        }
    })
    .await
    .and_then(|result| result);
    if let Err(err) = rewritten {
        eprintln!("Failed to refresh the classic context menu entry: {err}");
    }

    if let Some(config) = cmrs::read_config() {
        let classic = cmrs::includes_classic_menu(&config);
        if cmrs::read_config_text().as_deref() != Some(cmrs::config_text(&exe, classic).as_str()) {
            if let Err(err) = cmrs::enable(http, &exe, classic).await {
                eprintln!("Failed to refresh the Windows 11 context menu entry: {err}");
            }
        }
    }
}

pub fn unregister() {
    remove_classic_verbs();
    cmrs::unregister_offline();
}

fn classic_verbs_installed() -> bool {
    registry::key_exists(&format!(r"{ALL_FILES_SHELL}\{VERB_NAME}"))
}

/// Explorer shows a per-extension verb instead of a same-named `*` one, which is how images and videos get their own label.
fn write_classic_verbs(exe: &Path) -> Result<(), String> {
    remove_classic_verbs();

    let exe = exe.display();
    let icon = format!("\"{exe}\",0");
    let command = format!("\"{exe}\" {IMPORT_ARG} \"%1\"");

    let mut targets = vec![(ALL_FILES_SHELL.to_string(), FILE_TITLE.single)];
    for (extensions, title) in &TYPED_TITLES {
        targets.extend(
            extensions
                .iter()
                .map(|ext| (format!(r"{FILE_ASSOC_ROOT}\.{ext}\shell"), title.single)),
        );
    }

    for (parent, title) in targets {
        let key = format!(r"{parent}\{VERB_NAME}");
        registry::set_string(&key, None, title)?;
        registry::set_string(&key, Some("Icon"), &icon)?;
        registry::set_string(&format!(r"{key}\command"), None, &command)?;
    }
    Ok(())
}

fn remove_classic_verbs() {
    registry::delete_tree(&format!(r"{ALL_FILES_SHELL}\{VERB_NAME}"));
    for association in registry::subkeys(FILE_ASSOC_ROOT) {
        registry::delete_tree(&format!(r"{FILE_ASSOC_ROOT}\{association}\shell\{VERB_NAME}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The file's classic context menu entries, as Explorer itself builds them.
    fn menu_entries(dir: &Path, file: &str) -> Vec<String> {
        let script = format!(
            "(New-Object -ComObject Shell.Application).NameSpace('{}').ParseName('{file}').Verbs() | ForEach-Object {{ $_.Name }}",
            dir.display()
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .expect("powershell runs");
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|line| line.trim().replace('&', ""))
            .collect()
    }

    /// Writes the verbs only if they aren't installed already, and then removes them again.
    #[test]
    #[ignore = "may write HKCU shell verbs and reads Explorer's menu; run manually via: cargo test -- --ignored"]
    fn classic_verbs_show_in_explorer() {
        let already_installed = classic_verbs_installed();

        let dir = std::env::temp_dir().join("rosemyne-context-menu-test");
        std::fs::create_dir_all(&dir).unwrap();
        let files = [
            ("a.png", TYPED_TITLES[0].1.single),
            ("b.mp4", TYPED_TITLES[1].1.single),
            ("c.zip", FILE_TITLE.single),
        ];
        for (file, _) in files {
            std::fs::write(dir.join(file), b"test").unwrap();
        }

        let written = if already_installed {
            Ok(())
        } else {
            write_classic_verbs(Path::new(r"C:\Rosemyne\rosemyne.exe"))
        };
        let menus: Vec<Vec<String>> = files.iter().map(|(file, _)| menu_entries(&dir, file)).collect();
        if !already_installed {
            remove_classic_verbs();
        }
        let _ = std::fs::remove_dir_all(&dir);
        written.unwrap();

        for ((file, title), menu) in files.iter().zip(&menus) {
            assert!(menu.iter().any(|entry| entry == title), "{file} has no {title:?}: {menu:?}");
            if *title != FILE_TITLE.single {
                // the per-type verb replaces the generic one instead of adding a second entry
                assert!(!menu.iter().any(|entry| entry == FILE_TITLE.single), "{file}: {menu:?}");
            }
        }
    }
}
