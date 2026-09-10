use std::{
    io,
    process::{Child, Command},
};

/// Starts the command in its own process group. Elan and Lake spawn their own
/// children (`lake`, `git`, `lean`), and killing only the direct child leaves
/// those running after LeanLander stops them.
pub(crate) fn isolate_process_group(command: &mut Command) -> &mut Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// Kills the child and every process in its group. Call this before reaping
/// the child so its process group id cannot have been reused.
pub(crate) fn kill_process_tree(child: &mut Child) -> io::Result<()> {
    #[cfg(unix)]
    if let Ok(group) = libc::pid_t::try_from(child.id()) {
        // SAFETY: `kill` has no memory-safety preconditions; a negative pid
        // addresses the process group created by `isolate_process_group`.
        if unsafe { libc::kill(-group, libc::SIGKILL) } == 0 {
            return Ok(());
        }
    }
    child.kill()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{BufRead, BufReader},
        process::Stdio,
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn kills_grandchildren_with_the_child() {
        let mut command = Command::new("sh");
        command
            .args(["-c", "sleep 30 & echo $!; wait"])
            .stdout(Stdio::piped());
        let mut child = isolate_process_group(&mut command).spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let grandchild = line.trim().to_owned();

        kill_process_tree(&mut child).unwrap();
        child.wait().unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let alive = || {
            fs::read_to_string(format!("/proc/{grandchild}/stat"))
                .is_ok_and(|stat| !stat.contains(") Z "))
        };
        while alive() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !alive(),
            "grandchild {grandchild} outlived its process group"
        );
    }
}
