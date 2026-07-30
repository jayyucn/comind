对于你的电脑（**i7-10700F + 32GB 内存 + RTX2060 4GB**），我建议直接部署 **Qwen3.5 9B**，作为主力模型。

这是目前最省事、兼容性最好的方案。

---

## 第一步：安装 Ollama

下载并安装最新版 Ollama：

[Ollama 下载页面](https://ollama.com/download?utm_source=chatgpt.com)

安装完成后，在 PowerShell 中验证：

```bash
ollama --version
```

如果能显示版本号，就说明安装成功。

---

## 第二步：下载 Qwen3.5 9B

最新版 Ollama 已支持 Qwen3.5 系列。([Ollama][1])

执行：

```bash
ollama run qwen3.5:9b
```

第一次运行会自动下载模型（Q4 量化约 **6.6GB**）。([Qwen35][2])

下载完成后即可开始聊天：

```
>>> 你好
```

查看本地模型：

```bash
ollama list
```

删除模型：

```bash
ollama rm qwen3.5:9b
```

设置环境变量：

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "Machine")
```

---

## 第三步：安装聊天界面（推荐）

命令行虽然能用，但长期体验一般。

推荐安装 **Open WebUI**。

如果已经安装 Docker Desktop：

```bash
docker run -d ^
-p 3000:8080 ^
--add-host=host.docker.internal:host-gateway ^
-e OLLAMA_BASE_URL=http://host.docker.internal:11434 ^
--name open-webui ^
ghcr.io/open-webui/open-webui:main
```

浏览器访问：

```
http://localhost:3000
```

即可获得类似 ChatGPT 的界面。([Qwen35][2])

---

## 第四步：开发调用

Ollama 会自动启动本地 API：

```
http://localhost:11434
```

Python 示例：

```python
from ollama import chat

response = chat(
    model="qwen3.5:9b",
    messages=[
        {"role": "user", "content": "你好"}
    ]
)

print(response.message.content)
```

---

## 第五步：VS Code 接入

如果你使用：

* Continue
* Roo Code
* GitHub Copilot Chat（本地模型）
* Cline

都可以直接连接 Ollama。新版 VS Code 甚至可以直接识别 Ollama 本地模型。([Ollama][3])

配置通常为：

```
Provider
Ollama

URL
http://localhost:11434

Model
qwen3.5:9b
```

---

## 针对你的电脑建议

你的 **4GB 显存** 无法完整装下 9B 模型，因此主要会采用 **CPU + 32GB 内存** 推理，GPU 只能提供部分加速。

我建议同时安装两个模型：

```text
qwen3.5:4b    ← 日常使用（速度最快）
qwen3.5:9b    ← 深度思考、复杂代码、架构设计
```

切换只需要：

```bash
ollama run qwen3.5:4b
```

或

```bash
ollama run qwen3.5:9b
```

---

### 如果是你的 Comind 项目

结合你之前的需求（本地优先、知识库、Tauri、Agent），我会建议采用下面这套长期配置：

| 用途           | 模型              |
| ------------ | --------------- |
| 日常聊天、知识整理    | Qwen3.5 4B      |
| 复杂推理、代码、架构   | Qwen3.5 9B      |
| Embedding    | BGE-M3          |
| Reranker（可选） | BGE-Reranker-v2 |

这样既能保证日常响应速度，又能在需要时获得更高质量的推理能力。

[1]: https://www.ollama.com/library/qwen3.5%3A122b-a10b?utm_source=chatgpt.com "qwen3.5:122b-a10b"
[2]: https://qwen35.cn/en/?utm_source=chatgpt.com "Qwen3.5 Local Deployment Guide | Best Model for Your Hardware | qwen35.cn"
[3]: https://docs.ollama.com/integrations/vscode?utm_source=chatgpt.com "VS Code - Ollama"
