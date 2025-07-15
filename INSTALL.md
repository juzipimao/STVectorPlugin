# SillyTavern 向量管理插件安装指南

## 安装步骤

### 1. 下载插件文件

确保您有以下文件：
- `manifest.json` - 插件配置文件
- `index.js` - 主程序文件
- `style.css` - 样式文件
- `README.md` - 说明文档

### 2. 找到 SillyTavern 扩展目录

SillyTavern 的第三方扩展目录通常位于：
```
SillyTavern/public/scripts/extensions/third-party/
```

### 3. 创建插件目录

在第三方扩展目录中创建一个新文件夹：
```
SillyTavern/public/scripts/extensions/third-party/vector-manager/
```

### 4. 复制插件文件

将所有插件文件复制到刚创建的目录中：
```
vector-manager/
├── manifest.json
├── index.js
├── style.css
├── README.md
└── INSTALL.md
```

### 5. 重启 SillyTavern

- 如果 SillyTavern 正在运行，请重启应用
- 或者刷新浏览器页面

### 6. 启用插件

1. 打开 SillyTavern
2. 点击右上角的扩展管理按钮
3. 在扩展列表中找到"向量管理插件"
4. 点击启用开关

### 7. 验证安装

1. 在右侧设置面板中应该能看到"向量管理插件"按钮
2. 点击按钮应该能打开配置模态框
3. 检查浏览器控制台是否有错误信息

## 配置要求

### 必需依赖
- SillyTavern 最新版本
- 启用的 `vectors` 扩展

### API 配置
- 向量化 API Key（如 OpenAI Embeddings）
- （可选）Cohere Rerank API Key

## 故障排除

### 插件无法加载
1. 检查文件路径是否正确
2. 确认 `manifest.json` 格式正确
3. 查看浏览器控制台错误信息
4. 确认 SillyTavern 版本兼容性

### 插件按钮不显示
1. 确认插件已在扩展管理中启用
2. 刷新页面重新加载
3. 检查是否有 JavaScript 错误

### 向量功能不工作
1. 确认 `vectors` 扩展已启用
2. 检查 API Key 配置
3. 查看网络连接状态
4. 检查 SillyTavern 后端日志

## 卸载插件

1. 在扩展管理中禁用插件
2. 删除插件目录：
   ```
   SillyTavern/public/scripts/extensions/third-party/vector-manager/
   ```
3. 重启 SillyTavern

## 更新插件

1. 备份当前设置（可选）
2. 下载新版本文件
3. 替换插件目录中的文件
4. 重启 SillyTavern
5. 检查设置是否需要重新配置

## 技术支持

如果遇到问题，请：
1. 查看浏览器控制台错误信息
2. 检查 SillyTavern 后端日志
3. 确认所有依赖都已正确安装
4. 在项目 GitHub 页面提交 Issue

## 开发者信息

- **作者**: 梅川晓钡锌
- **版本**: 1.0.0
- **许可证**: Apache-2.0

---

**注意**: 本插件需要有效的 API Key 才能正常工作。请确保您有足够的 API 配额，并遵守相关服务的使用条款。
