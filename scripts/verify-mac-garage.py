"""Open the packaged application and exercise the garage, vehicles and city."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

app = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix="roadster-garage-") as folder:
    log = Path(folder) / "events.jsonl"
    command = [str(app / "Contents/MacOS/Roadster Flight Lab"),
               "--audit-mode=garage-view", f"--audit-output={log}"]
    process = subprocess.Popen(command)
    try:
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            if process.poll() is not None:
                sys.exit(f"Application exited with code {process.returncode}")
            if log.exists():
                for line in log.read_text().splitlines():
                    try:
                        event = json.loads(line).get("sample", {})
                    except json.JSONDecodeError:
                        continue  # The application may still be writing this line.
                    if "Error creating WebGL context" in line:
                        sys.exit("The test host could not create a WebGL context")
                    if event.get("event") == "garage-view-complete":
                        if not event.get("passed"):
                            sys.exit(f"Garage verification failed: {event}")
                        print(f"Passed {len(event['checkpoints'])} garage and city checks")
                        sys.exit(0)
            time.sleep(1)
        if log.exists():
            for line in log.read_text().splitlines()[-8:]:
                print(line[:1200], file=sys.stderr)
        sys.exit("Timed out waiting for the garage and city checks")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
