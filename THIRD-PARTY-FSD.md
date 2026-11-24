# FSD 资源与授权

- Plan-R1：Xiaolong Tang 等，官方源码 https://github.com/XiaolongTang23/Plan-R1 ，固定提交 23bc54433599002f275c18b88cf261ab5e87d775，Apache 2.0。原始官方 fine-tuning.ckpt 由作者 README 指向的公开 Google Drive 取得，SHA-256 c5f590b3ae2b1bda0a684f3a826289c8b4336a9ce7424fea18be3f1bce0b9259。没有修改权重；仅将官方推理部分提取为 nn.Module，去除训练指标、奖励和绘图依赖。权重链接没有独立附加许可证声明，不能把源码许可自行扩张为作者未声明的其他保证。
- DriveScene Studio：Peixin。使用旧版 ba307215f5ce67289a9cacea8ae6fb54870d5307；通过其公开历史镜像 https://github.com/prajeeshmp86/DriveScene-Studio 获取。MIT 代码、原始场景资源 CC BY 4.0。此提交是官方明确保留旧许可的 8caea0d 历史快照祖先，证据见 reports/fsd/usable-source-provenance.json。复用旧版烘焙环境、配色和灯光设计，新增了可驾驶城市、碰撞体和导航。排除当前发布版受限源码及新素材。
- BMW X6M Competition Assetto：vecarz / heynic，CC BY 4.0。原模型 https://sketchfab.com/3d-models/bmw-x6m-competition-assetto-wwwvecarzcom-3979a908081948e0971f5a5380b60a0f 。保留旧版 DriveScene 外观整理，增加四轮真实分离、正确轴心、不同车漆和交通专用 LOD。中远 LOD 为位置接缝合并、重算法线的有损衍生版本；原模型与近处精度副本另行保留。许可 https://creativecommons.org/licenses/by/4.0/ 。
- CPython：Python Software Foundation；自包含 arm64 运行环境由 https://github.com/astral-sh/python-build-standalone 经 uv 取得。
- PyTorch、PyG、torch-scatter、NumPy、SciPy、scikit-learn、Shapely 及其运行依赖：版本见 fsd-runtime/runtime-manifest.json，各自许可保留在包内 dist-info / LICENSE。Lightning、训练指标、绘图及模型下载器不进入运行包。
- Three.js、meshoptimizer：MIT；Electron 与原有 Rapier 按项目现有许可保留。Electron 已更新至 44.11.5 安全维护版本。

Tesla 车型与商标归各权利人。完整车型与环境署名见本目录的 ASSET-CREDITS.md。
