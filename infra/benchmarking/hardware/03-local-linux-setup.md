# Local Linux GPU Setup

For benchmarking on your own Linux machine with an NVIDIA GPU. If you're on Windows, see `04-windows-wsl2-setup.md`.

## Tested distros

- Ubuntu 22.04 LTS / 24.04 LTS — recommended; vLLM and TGI both ship `.deb`-friendly install paths
- Debian 12 — works
- Fedora 40 — works but expect to fight CUDA path resolution
- Arch — works for the patient

## Prerequisites

```bash
sudo apt update
sudo apt install -y build-essential git curl wget
```

## NVIDIA driver

Ubuntu makes this easy:

```bash
# Pick a recent driver (550+ recommended for CUDA 12.4)
ubuntu-drivers list
sudo ubuntu-drivers install nvidia:550
sudo reboot
```

Verify:

```bash
nvidia-smi
# Expected: shows your GPU, driver, CUDA version
```

If `nvidia-smi` says "command not found" after reboot, the install failed. Common fix:

```bash
sudo apt purge "*nvidia*" "libnvidia*"
sudo apt autoremove
sudo ubuntu-drivers install nvidia:550
sudo reboot
```

## CUDA Toolkit

Most workloads (vLLM, TGI) ship CUDA inside their containers — you don't need a host-side toolkit. But for native llama.cpp builds:

```bash
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install -y cuda-toolkit-12-4
echo 'export PATH=/usr/local/cuda-12.4/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.4/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc
```

Verify:

```bash
nvcc --version
# Should show release 12.4.x
```

## Docker + NVIDIA Container Toolkit

For the docker-compose.yaml in `infra/benchmarking/docker/` to work, Docker needs GPU passthrough.

```bash
# Docker
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

# NVIDIA Container Toolkit
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit

sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Verify Docker can see the GPU:

```bash
docker run --gpus all --rm nvcr.io/nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
# Should show the same output as host nvidia-smi
```

## Node.js + npm

CodraGraph and the bench scripts need Node 20+:

```bash
# Use NodeSource for a recent version
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # should be v22.x
npm --version
```

## Disk and RAM

- **Disk:** 200 GB free recommended. Model weights eat space:
  - 7B FP16: ~14 GB
  - 13B FP16: ~26 GB
  - 32B Q4: ~20 GB
  - 70B Q4: ~40 GB
  - HuggingFace cache: doubles up if you switch quants
- **RAM:** 32+ GB recommended. The codragraph indexer loads grammars + ASTs in-memory; vLLM also benefits from RAM page cache.

## Swap (optional)

For low-RAM setups (< 32 GB), swap helps the indexer chunk parse without OOM:

```bash
sudo fallocate -l 32G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Power and thermals

If running benchmarks for hours:

- 4090 / 3090: 350–450 W peak. Make sure your PSU has headroom (target 80% load max). 1000 W PSU recommended for one card.
- A100: 250–400 W. PCIe vs SXM4 matters; PCIe is simpler.
- Cooling: airflow case minimum. Open-air GPUs may thermal throttle in stuffy cases — monitor `nvidia-smi --loop=5` during long runs.

```bash
# Watch GPU temp + utilization during a run
watch -n 1 'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv'
```

## Verifying the full stack

Before running benchmarks, sanity-check end-to-end:

```bash
cd infra/benchmarking/docker
cp .env.example .env
# Edit .env: set MODEL=Qwen/Qwen2.5-Coder-7B-Instruct (or any small model first)
docker compose up -d vllm

# Wait ~2 min for model download + load. Monitor:
docker compose logs -f vllm

# When you see "Application startup complete", test it:
curl http://localhost:8000/v1/models
# Should return JSON with the loaded model

# Hit it with a prompt:
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-Coder-7B-Instruct",
    "messages": [{"role": "user", "content": "Write a haiku about benchmarks."}],
    "max_tokens": 50
  }'
```

If you get a haiku back, the inference server is healthy. Now run the benchmark.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `CUDA out of memory` at vLLM startup | Lower `--gpu-memory-utilization` (try 0.85), or pick a smaller model / quant |
| vLLM hangs at "Loading model weights" | Network slow → consider pre-downloading via `huggingface-cli download` |
| `nvidia-smi` works on host but not in container | Re-run `sudo nvidia-ctk runtime configure` and restart docker |
| Random kernel panics under load | Driver too old for the GPU. Upgrade driver. |
| `permission denied` on `/dev/nvidia*` | Add user to `video` group; reboot |
