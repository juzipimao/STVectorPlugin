# SillyTavern 向量管理插件设计文档

**作者**: 梅川晓钡锌  
**版本**: 1.0.0  
**创建日期**: 2025-07-15  

## 分析与规划 (Analysis & Planning)

### 任务拆解 (Task Breakdown):
- [ ] 创建 SillyTavern 扩展基础结构（manifest.json、index.js）
- [ ] 设计并实现模态框 UI 界面
- [ ] 实现向量查询区域功能模块
- [ ] 实现 Rerank 区域功能模块
- [ ] 实现注入区域功能模块
- [ ] 实现向量化区域功能模块
- [ ] 集成 SillyTavern 向量 API
- [ ] 实现设置持久化存储
- [ ] 添加预览功能
- [ ] 实现通知系统
- [ ] 测试和调试功能

### UI 结构树状图 (UI Structure Tree):
```
SillyTavern 向量管理插件
├── 设置面板按钮
│   └── 触发模态框显示
│
└── 主模态框界面
    ├── 向量查询区域
    │   ├── API Key 输入框
    │   ├── 模型向量化选择
    │   ├── 功能开关
    │   ├── 通知开关
    │   ├── 块大小设置
    │   ├── 重叠设置
    │   ├── 分数阈值设置
    │   ├── 查询消息数量
    │   └── 最大结果数量
    │
    ├── Rerank 区域
    │   ├── 启用开关
    │   ├── 通知开关
    │   ├── API Key 输入框
    │   ├── 模型选择
    │   ├── Rerank Top N 设置
    │   └── 混合权重设置
    │
    ├── 注入区域
    │   ├── 注入提示词输入框
    │   ├── 聊天内@深度设置
    │   └── 角色类型选择（系统/角色/模型）
    │
    ├── 向量化区域
    │   ├── 聊天消息勾选
    │   ├── 聊天层数范围（X-X）
    │   ├── 消息类型选择
    │   │   ├── 用户消息
    │   │   ├── AI 消息
    │   │   └── 隐藏消息
    │   ├── 向量化开始按钮
    │   ├── 向量结果列表
    │   └── 预览功能按钮
    │
    └── 控制按钮区域
        ├── 保存设置
        ├── 重置设置
        └── 关闭模态框
```

### 逻辑流程树状图 (Logic Flow Tree):
```
插件工作流程
├── 初始化阶段
│   ├── 扩展加载
│   ├── 设置面板注册
│   ├── 事件监听器绑定
│   └── 默认配置加载
│
├── 用户交互阶段
│   ├── 点击设置按钮
│   ├── 模态框显示
│   ├── 配置参数调整
│   └── 功能开关控制
│
├── 向量查询流程
│   ├── 获取最近聊天记录
│   ├── 文本预处理
│   ├── 向量化查询
│   ├── 相似度计算
│   ├── 结果筛选（分数阈值）
│   └── 通知反馈（可选）
│
├── Rerank 处理流程
│   ├── 检查 Rerank 开关
│   ├── 获取初步查询结果
│   ├── 调用 Rerank API
│   ├── 重新排序结果
│   ├── 应用 Top N 限制
│   ├── 混合权重计算
│   └── 通知反馈（可选）
│
├── 注入处理流程
│   ├── 获取最终查询结果
│   ├── 应用注入模板
│   ├── 确定注入位置（@深度）
│   ├── 选择注入角色类型
│   └── 插入到聊天上下文
│
├── 向量化处理流程
│   ├── 解析聊天层数范围
│   ├── 筛选消息类型
│   ├── 提取目标消息
│   ├── 文本分块处理
│   ├── 批量向量化
│   ├── 存储向量数据
│   └── 更新结果列表
│
└── 预览功能流程
    ├── 获取当前聊天记录
    ├── 应用层数筛选
    ├── 应用类型筛选
    ├── 生成预览内容
    └── 显示预览模态框
```

## 详细功能规格说明

### 1. 向量查询区域功能规格
- **API Key 输入**：支持加密存储，验证有效性
- **模型选择**：下拉菜单，支持自定义模型名称
- **功能开关**：全局启用/禁用向量查询
- **通知开关**：控制查询成功/失败通知显示
- **块大小**：文本分块大小，范围 100-2000 字符
- **重叠设置**：相邻块重叠字符数，范围 0-500 字符
- **分数阈值**：相似度匹配最低分数，范围 0.0-1.0
- **查询消息数**：用于查询的最近消息数量，范围 1-50
- **最大结果数**：返回的最大结果数量，范围 1-100

### 2. Rerank 区域功能规格
- **启用开关**：控制 Rerank 功能的开启/关闭
- **通知开关**：控制 Rerank 处理通知
- **API Key**：Rerank 服务的 API 密钥
- **模型选择**：Rerank 模型名称
- **Top N 设置**：Rerank 后保留的结果数量
- **混合权重**：向量分数与 Rerank 分数的混合比例

### 3. 注入区域功能规格
- **注入提示词**：自定义注入模板，支持变量替换
- **@深度设置**：在聊天历史中的注入位置
- **角色类型**：注入消息的角色类型（系统/角色/模型）

### 4. 向量化区域功能规格
- **聊天消息勾选**：启用/禁用聊天消息向量化
- **层数范围**：指定要向量化的消息范围（如 1-10）
- **消息类型筛选**：
  - 用户消息：包含用户发送的消息
  - AI 消息：包含 AI 回复的消息
  - 隐藏消息：包含被隐藏的消息
- **向量化按钮**：执行向量化处理
- **结果列表**：显示已向量化的内容，支持排序
- **预览功能**：预览将要向量化的内容

### 5. 技术实现要点
- **异步处理**：所有 API 调用使用异步方式，避免界面阻塞
- **错误处理**：完善的错误捕获和用户友好的错误提示
- **性能优化**：批量处理、缓存机制、防抖动
- **数据持久化**：设置自动保存，支持导入/导出
- **兼容性**：与 SillyTavern 核心功能无缝集成

### 6. 用户体验设计
- **直观界面**：清晰的分区布局，易于理解和操作
- **实时反馈**：操作状态实时显示，进度条和通知
- **响应式设计**：适配不同屏幕尺寸
- **快捷操作**：支持键盘快捷键和批量操作
- **帮助文档**：内置使用说明和示例

### 核心代码调用及依赖分析 (Core Code Call & Dependency Analysis):
```
SillyTavern 向量管理插件架构
├── 主入口文件 (index.js)
│   ├── 扩展初始化
│   │   ├── SillyTavern.getContext() (获取应用上下文)
│   │   │   ├── chat (聊天记录数组)
│   │   │   ├── characters (角色列表)
│   │   │   ├── extensionSettings (扩展设置对象)
│   │   │   └── saveSettingsDebounced (保存设置函数)
│   │   ├── 设置面板按钮注册
│   │   └── 模态框 HTML 注入
│   │
│   ├── 向量查询管理器
│   │   ├── 聊天记录获取器
│   │   │   ├── getRecentMessages(count) (获取最近消息)
│   │   │   ├── filterMessagesByType(messages, types) (按类型筛选)
│   │   │   └── extractTextContent(messages) (提取文本内容)
│   │   ├── 向量 API 调用器
│   │   │   ├── /api/vector/query (相似度搜索)
│   │   │   ├── /api/vector/insert (批量插入向量)
│   │   │   └── /api/vector/list (获取向量列表)
│   │   └── 结果处理器
│   │       ├── scoreFiltering(results, threshold) (分数筛选)
│   │       ├── limitResults(results, maxCount) (结果数量限制)
│   │       └── formatResults(results) (结果格式化)
│   │
│   ├── Rerank 处理器
│   │   ├── Rerank API 集成
│   │   │   ├── callRerankAPI(query, documents, apiKey, model)
│   │   │   └── processRerankResponse(response)
│   │   ├── 权重混合器
│   │   │   ├── calculateHybridScore(vectorScore, rerankScore, weight)
│   │   │   └── reorderByHybridScore(results)
│   │   └── Top N 筛选器
│   │       └── selectTopN(results, n)
│   │
│   ├── 注入管理器
│   │   ├── 模板处理器
│   │   │   ├── applyTemplate(content, template)
│   │   │   └── replaceVariables(template, variables)
│   │   ├── 位置计算器
│   │   │   ├── calculateInjectionDepth(depth)
│   │   │   └── findInjectionPoint(chat, depth)
│   │   └── 角色类型处理器
│   │       ├── createSystemMessage(content)
│   │       ├── createCharacterMessage(content)
│   │       └── createModelMessage(content)
│   │
│   ├── 向量化处理器
│   │   ├── 消息筛选器
│   │   │   ├── parseLayerRange(rangeString) (解析层数范围)
│   │   │   ├── filterByLayer(messages, startLayer, endLayer)
│   │   │   └── filterByMessageType(messages, types)
│   │   ├── 文本分块器
│   │   │   ├── splitIntoChunks(text, chunkSize, overlap)
│   │   │   └── createChunkMetadata(chunk, source, index)
│   │   └── 批量向量化器
│   │       ├── batchVectorize(chunks, batchSize)
│   │       └── storeVectorData(vectors, metadata)
│   │
│   ├── 预览功能管理器
│   │   ├── 内容提取器
│   │   │   ├── extractPreviewContent(layerRange, messageTypes)
│   │   │   └── formatPreviewText(content)
│   │   └── 预览界面控制器
│   │       ├── showPreviewModal(content)
│   │       └── updatePreviewContent(content)
│   │
│   ├── 通知系统
│   │   ├── 查询通知器
│   │   │   ├── notifyQuerySuccess(resultCount)
│   │   │   └── notifyQueryError(error)
│   │   └── Rerank 通知器
│   │       ├── notifyRerankSuccess(resultCount)
│   │       └── notifyRerankError(error)
│   │
│   ├── 设置管理器
│   │   ├── 配置加载器
│   │   │   ├── loadDefaultSettings()
│   │   │   ├── loadUserSettings()
│   │   │   └── validateSettings(settings)
│   │   ├── 配置保存器
│   │   │   ├── saveSettings(settings)
│   │   │   └── exportSettings()
│   │   └── 配置重置器
│   │       └── resetToDefaults()
│   │
│   └── UI 控制器
│       ├── 模态框管理器
│       │   ├── showModal()
│       │   ├── hideModal()
│       │   └── updateModalContent()
│       ├── 表单控制器
│       │   ├── bindFormEvents()
│       │   ├── validateFormInputs()
│       │   └── updateFormValues()
│       └── 结果列表管理器
│           ├── renderResultList(results)
│           ├── sortResults(results, sortBy)
│           └── updateResultDisplay()
│
├── 样式文件 (style.css)
│   ├── 模态框样式
│   ├── 表单控件样式
│   ├── 结果列表样式
│   └── 响应式布局
│
├── 设置界面 (settings.html)
│   ├── 向量查询区域表单
│   ├── Rerank 区域表单
│   ├── 注入区域表单
│   ├── 向量化区域表单
│   └── 预览功能界面
│
└── 配置文件 (manifest.json)
    ├── 扩展元数据
    │   ├── display_name: "向量管理插件"
    │   ├── version: "1.0.0"
    │   ├── author: "梅川晓钡锌"
    │   └── description: "SillyTavern 向量查询和管理插件"
    ├── 文件引用
    │   ├── js: "index.js"
    │   ├── css: "style.css"
    │   └── html: "settings.html"
    ├── 依赖声明
    │   └── dependencies: ["vectors"]
    └── 权限设置
        └── loading_order: 10
```

## 项目文件结构

```
vector-manager-plugin/
├── manifest.json          # 扩展配置文件
├── index.js              # 主入口文件
├── style.css             # 样式文件
├── settings.html         # 设置界面模板
└── README.md            # 使用说明文档
```

## 开发计划

### 第一阶段：基础框架搭建
1. 创建扩展基础文件结构
2. 实现模态框基础界面
3. 集成 SillyTavern 扩展 API

### 第二阶段：核心功能实现
1. 向量查询功能开发
2. Rerank 功能集成
3. 注入机制实现

### 第三阶段：高级功能开发
1. 向量化处理功能
2. 预览功能实现
3. 通知系统完善

### 第四阶段：优化和测试
1. 性能优化
2. 错误处理完善
3. 用户体验优化
4. 全面测试和调试

## 配置文件示例

### manifest.json
```json
{
    "display_name": "向量管理插件",
    "loading_order": 10,
    "requires": [],
    "optional": [],
    "dependencies": ["vectors"],
    "js": "index.js",
    "css": "style.css",
    "author": "梅川晓钡锌",
    "version": "1.0.0",
    "homePage": "https://github.com/your-username/vector-manager-plugin",
    "auto_update": true,
    "description": "为 SillyTavern 提供强大的向量查询、Rerank 和内容管理功能"
}
```

### 默认设置配置
```javascript
const defaultSettings = {
    // 向量查询设置
    vectorQuery: {
        enabled: true,
        apiKey: '',
        model: 'text-embedding-ada-002',
        chunkSize: 512,
        overlap: 50,
        scoreThreshold: 0.7,
        queryMessageCount: 5,
        maxResults: 10,
        notifySuccess: true
    },

    // Rerank 设置
    rerank: {
        enabled: false,
        notify: true,
        apiKey: '',
        model: 'rerank-multilingual-v2.0',
        topN: 5,
        hybridWeight: 0.5
    },

    // 注入设置
    injection: {
        template: '相关内容：\n{{text}}',
        depth: 1,
        roleType: 'system' // system, character, model
    },

    // 向量化设置
    vectorization: {
        includeChatMessages: true,
        layerRange: '1-10',
        messageTypes: {
            user: true,
            ai: true,
            hidden: false
        }
    }
};
```

## API 集成说明

### SillyTavern 向量 API
```javascript
// 查询向量
const queryVectors = async (text, maxResults = 10) => {
    const response = await fetch('/api/vector/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: text,
            top_k: maxResults,
            threshold: settings.vectorQuery.scoreThreshold
        })
    });
    return await response.json();
};

// 插入向量
const insertVectors = async (chunks) => {
    const response = await fetch('/api/vector/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunks })
    });
    return await response.json();
};
```

### Rerank API 集成
```javascript
const callRerankAPI = async (query, documents, apiKey, model) => {
    const response = await fetch('https://api.cohere.ai/v1/rerank', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            query: query,
            documents: documents,
            top_n: settings.rerank.topN
        })
    });
    return await response.json();
};
```

## 用户界面设计

### 模态框布局
- **标题栏**：插件名称和关闭按钮
- **标签页导航**：四个主要功能区域的切换
- **内容区域**：当前选中标签页的配置界面
- **底部按钮**：保存、重置、关闭等操作按钮

### 响应式设计
- **桌面端**：宽度 800px，高度自适应
- **移动端**：全屏显示，垂直滚动
- **平板端**：适中尺寸，保持良好的可读性

## 错误处理和用户反馈

### 错误类型
1. **API 连接错误**：网络问题或服务不可用
2. **认证错误**：API Key 无效或过期
3. **参数错误**：用户输入的参数不合法
4. **数据处理错误**：向量化或查询过程中的异常

### 通知系统
- **成功通知**：绿色提示，显示操作结果
- **警告通知**：黄色提示，提醒用户注意事项
- **错误通知**：红色提示，显示错误信息和解决建议
- **进度通知**：蓝色提示，显示长时间操作的进度

这个插件将为 SillyTavern 用户提供一个功能完整、易于使用的向量管理解决方案，大大提升聊天体验和内容管理效率。
