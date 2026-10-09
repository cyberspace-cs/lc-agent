---
name: my-test1-skill
description: >-
  运行 scripts/print_test.py 验证命令行与 skill 脚本执行是否正常。
  仅在用户明确要求运行这个 skill 或这个脚本时使用，不自动触发。
disable-model-invocation: true
---

## 环境

- Windows + PowerShell
- Python 解释器：`D:\ProgramData\Miniconda3\envs\py312\python.exe`
- 项目根目录（PYTHONPATH）：`D:\codes\lc-agent`

## 步骤

1. 运行脚本：

```powershell
$env:PYTHONPATH="D:\codes\lc-agent"; & "D:\ProgramData\Miniconda3\envs\py312\python.exe" "D:\codes\lc-agent\.agents\skills\my-test1-skill\scripts\print_test.py"
```

2. 校验结果：stdout 依次输出 `0`–`9`（每秒一行），exit_code 为 0，耗时约 10 秒。

## 边界

- 输出不符合上述预期，或脚本报错 → 原样回报 stdout/stderr 与 exit_code，不要自行改动脚本。
