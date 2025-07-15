# SillyTavern 向量管理插件

**作者**: 梅川晓钡锌
**版本**: 1.0.0

## 简介

这是一个为 SillyTavern 设计的强大向量管理插件，提供向量查询、Rerank、内容注入和向量化等功能，帮助用户更好地管理和利用聊天记录。

## 主要功能

### 🔍 向量查询区域
- 多种API端点支持（OpenAI、Azure OpenAI、自定义端点）
- API Key 配置和模型选择
- 可调节的块大小、重叠和分数阈值
- 查询消息数量和结果数量控制
- 批处理大小配置
- API连接测试功能
- 向量存储统计和管理
- 查询成功通知开关

### 🔄 Rerank 区域
- 支持 Cohere Rerank API
- 可配置的 Top N 和混合权重
- Rerank 处理通知

### 💉 注入区域
- 自定义注入提示词模板
- 可配置的聊天深度和角色类型
- 支持系统、角色、模型三种注入方式

### 📊 向量化区域
- 聊天消息选择和层数范围设置
- 用户消息、AI消息、隐藏消息类型筛选
- 实时预览功能
- 向量化结果列表显示

## 安装方法

1. 将插件文件放置在 SillyTavern 的第三方扩展目录：
   ```
   SillyTavern/public/scripts/extensions/third-party/vector-manager/
   ```

2. 确保目录结构如下：
   ```
   vector-manager/
   ├── manifest.json
   ├── index.js
   ├── style.css
   └── README.md
   ```

3. 重启 SillyTavern 或刷新页面

4. 在扩展管理界面启用"向量管理插件"

## 使用方法

### 基础配置

1. 点击右侧设置面板中的"向量管理插件"按钮
2. 在弹出的模态框中配置各项参数：
   - **向量查询**：设置 API Key、模型、块大小等参数
   - **Rerank**：配置 Rerank API 和相关参数
   - **注入设置**：自定义注入模板和位置
   - **向量化**：选择要向量化的消息类型和范围

### 向量化操作

1. 在"向量化"标签页中：
   - 勾选"聊天消息"
   - 设置层数范围（如 "1-10"）
   - 选择消息类型（用户消息、AI消息、隐藏消息）
   - 点击"预览"查看将要处理的内容
   - 点击"开始向量化"执行处理

### 查询功能

向量查询会在聊天过程中自动触发，根据最近的消息内容查找相关的向量化内容，并根据配置进行 Rerank 处理和内容注入。

### API 端点配置

插件支持多种向量化 API 端点：

#### OpenAI API
- 端点：`https://api.openai.com/v1/embeddings`
- 认证：Bearer Token
- 支持模型：text-embedding-ada-002, text-embedding-3-small, text-embedding-3-large

#### Azure OpenAI
- 端点：需要配置完整的 Azure 端点 URL
- 认证：API Key
- 格式：`https://your-resource.openai.azure.com/openai/deployments/your-deployment/embeddings?api-version=2023-05-15`

#### 自定义端点
- 支持任何兼容 OpenAI Embeddings API 格式的服务
- 可配置自定义 URL 和认证方式

### 本地存储

- 向量数据存储在浏览器本地存储中
- 支持向量统计查看和存储管理
- 可以清空向量存储重新开始

## 配置说明

### 向量查询参数
- **块大小**: 文本分块的大小，建议 256-1024
- **重叠**: 相邻块的重叠字符数，建议 50-100
- **分数阈值**: 相似度匹配的最低分数，范围 0.0-1.0
- **查询消息数**: 用于查询的最近消息数量
- **最大结果数**: 返回的最大结果数量

### Rerank 参数
- **Top N**: Rerank 后保留的结果数量
- **混合权重**: 向量分数与 Rerank 分数的混合比例

### 注入参数
- **注入模板**: 使用 `{{text}}` 作为内容占位符
- **@深度**: 在聊天历史中的注入位置
- **角色类型**: 注入消息的角色类型

## 依赖要求

- SillyTavern 最新版本
- 有效的向量化 API（支持以下任一）：
  - OpenAI Embeddings API
  - Azure OpenAI Service
  - 兼容 OpenAI 格式的自定义 API
- （可选）Cohere Rerank API
- 现代浏览器支持（用于本地存储）

## 故障排除

### 常见问题

1. **插件无法加载**
   - 检查文件路径是否正确
   - 确认 manifest.json 格式正确
   - 查看浏览器控制台错误信息

2. **向量查询失败**
   - 检查 API Key 是否有效
   - 确认网络连接正常
   - 查看 SillyTavern 后端日志

3. **Rerank 不工作**
   - 确认 Rerank API Key 配置正确
   - 检查 Cohere API 服务状态
   - 验证模型名称是否正确

### 调试模式

在浏览器控制台中可以查看详细的调试信息：
```javascript
// 查看当前设置
console.log(SillyTavern.getContext().extensionSettings['vector-manager']);
```

## 更新日志

### v1.1.0 (2025-07-15)
- 🚀 **重大更新**：移除对 SillyTavern 内置向量 API 的依赖
- ✨ 新增多种 API 端点支持（OpenAI、Azure OpenAI、自定义端点）
- 💾 实现本地向量存储系统
- 🔧 添加 API 连接测试功能
- 📊 新增向量存储统计和管理功能
- ⚡ 优化批处理性能，支持自定义批处理大小
- 🛠️ 改进错误处理和用户反馈
- 📱 增强响应式界面设计

### v1.0.0 (2025-07-15)
- 初始版本发布
- 实现向量查询、Rerank、注入和向量化功能
- 添加完整的用户界面和配置选项

## 许可证

本项目采用 Apache-2.0 许可证，详见 LICENSE 文件。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个插件。

## 联系方式

如有问题或建议，请通过以下方式联系：
- GitHub Issues
- SillyTavern Discord 社区

---

**注意**: 本插件需要有效的 API Key 才能正常工作。请确保您有足够的 API 配额，并遵守相关服务的使用条款。