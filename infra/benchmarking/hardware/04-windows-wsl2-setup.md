# Windows + WSL2 GPU Setup

If you're on the Windows machine where the project lives (`D:\Projects\thinqmesh-codragraph`), this is your path. WSL2 with NVIDIA GPU passthrough lets you run the same Linux-based stack that production benchmarks use.

## Prerequisites

- Windows 11 (Windows 10 21H2+ also works)
- An NVIDIA GPU
- Recent NVIDIA Game Ready or Studio driver (550+ recommended)

## 1. Install WSL2 with Ubuntu

```powershell
# In an elevated PowerShell:
wsl --install -d Ubuntu-24.04
```

Reboot when prompted. After reboot, Ubuntu will finish setup and ask for a username/password.

Verify:

```powershell
wsl --list --verbose
# Should show Ubuntu-24.04, VERSION 2
```

## 2. NVIDIA driver — install on Windows side ONLY

This is the critical thing that catches people: **do NOT install Linux NVIDIA drivers inside WSL2.** WSL2 uses the Windows driver via a passthrough.

1. Update your Windows NVIDIA driver to 550+ (download from nvidia.com or use GeForce Experience)
2. Reboot

Verify from inside WSL2:

```bash
nvidia-smi
# Should work — shows the GPU as the Windows driver sees it
```

If `nvidia-smi` is "command not found" inside WSL2, your Windows driver is too old or your WSL2 kernel needs updating:

```powershell
wsl --update
```

## 3. CUDA Toolkit inside WSL2

```bash
# Inside Ubuntu WSL2:
wget https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install -y cuda-toolkit-12-4

# Add to PATH
echo 'export PATH=/usr/local/cuda-12.4/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.4/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc

nvcc --version
```

## 4. Docker Desktop with WSL2 backend

Recommended path for the `infra/benchmarking/docker/` compose stack.

1. Download Docker Desktop for Windows
2. During setup: enable **Use WSL 2 instead of Hyper-V**
3. After install: **Settings → Resources → WSL Integration** — enable for your `Ubuntu-24.04` distro
4. **Settings → Resources → GPU** — enable GPU support for WSL

Verify:

```bash
# Inside WSL2 Ubuntu:
docker run --gpus all --rm nvcr.io/nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
# Should show your GPU
```

## 5. File system performance — keep work inside WSL2

This is the most common Windows-WSL2 footgun.

**Don't** put the repo on Windows-mounted drives (`/mnt/d/...`). Cross-OS filesystem traversal is **10–30× slower** than native, and the codragraph indexer reads a lot of files.

**Do** clone fresh inside WSL2's own filesystem:

```bash
# Inside WSL2:
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/<your-fork>/thinqmesh-codragraph
cd thinqmesh-codragraph
```

If you must work with the existing `D:\Projects\thinqmesh-codragraph` folder, copy it into WSL2's filesystem first:

```bash
# This copy can take 5-10 minutes for a large monorepo
mkdir -p ~/projects && cp -r /mnt/d/Projects/thinqmesh-codragraph ~/projects/
cd ~/projects/thinqmesh-codragraph
```

You can edit on the Windows side via Cursor / VS Code with the WSL extension — those use the WSL filesystem natively.

## 6. Resource allocation

WSL2 takes a chunk of host RAM by default. For benchmarking, give it more:

Create `C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
memory=24GB           # adjust based on your host RAM
processors=8          # adjust based on your CPU
swap=16GB
swapFile=C:\\wsl-swap.vhdx

[experimental]
sparseVhd=true
```

Then restart WSL2:

```powershell
wsl --shutdown
wsl
```

## 7. Run a smoke test

```bash
cd ~/projects/thinqmesh-codragraph/infra/benchmarking/docker
cp .env.example .env
# Edit .env: pick a small model first, e.g. MODEL=Qwen/Qwen2.5-Coder-1.5B-Instruct
docker compose up -d vllm
docker compose logs -f vllm
# Wait for "Application startup complete"

curl http://localhost:8000/v1/models
```

If that returns the model JSON, you're set.

## Known Windows-specific gotchas

| Symptom | Fix |
|---|---|
| `nvidia-smi` works on Windows but not in WSL2 | Update Windows GPU driver; run `wsl --update` |
| Docker GPU container crashes immediately | Docker Desktop GPU support not enabled; check Settings → Resources → GPU |
| Code edits in `/mnt/d/...` are insanely slow | Move work into `~/projects/` (WSL2's own ext4) |
| WSL2 eats all RAM and Windows freezes | Set `.wslconfig` memory limit |
| Power-saving GPU clock-down during long runs | In Windows: NVIDIA Control Panel → Manage 3D settings → Power management → Prefer maximum performance |
| Hibernate / sleep kills the WSL2 instance mid-run | Run benchmarks while plugged in; disable sleep during runs |

## Performance expectations on Windows + WSL2

WSL2 + Docker passthrough has a small overhead vs native Linux:

- **GPU compute**: ~1–3% overhead (essentially free; passthrough is at the kernel level)
- **CPU + RAM**: ~5% overhead
- **Filesystem (when staying inside WSL2)**: native speed
- **Networking**: NAT'd through Hyper-V; ~1–5ms latency to localhost services on Windows host

Net: WSL2 is ~95% the speed of native Linux for our benchmarks. Acceptable.

## When to skip WSL2 and rent cloud GPU instead

If any of these are true:
- You don't have an NVIDIA GPU
- Your GPU is < 12 GB VRAM (only enough for tiny models)
- You don't want to spend a day on driver setup
- You need a 70B model for one of the benchmark cells

→ Rent on RunPod / Lambda / vast.ai. See `02-cloud-providers.md`. The full sweep costs <$20 and runs in 2–3 hours.
