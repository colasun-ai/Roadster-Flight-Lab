此目录的 3MF 是静态打印模型，不用于替换游戏 GLB。
打印说明见 roadster-print-instructions.txt；实际验证数据见 roadster-print-1_24.json。

重新生成（Python 3.12）：
python3 -m pip install -r requirements.txt
python3 rebuild-3mf.py ../public/models/roadster-drive-ready.glb regenerated.3mf

在此 print 目录运行上述命令。生成脚本拒绝覆盖输入文件和任何已有目标。
当前脚本针对本项目 Y-up、+Z 车头、米制、已烘焙变换的 GLB；车轴是内部连接，不是替换轮胎。
网格外观、打印薄细节和支撑选择仍需在切片软件中人工查看。
