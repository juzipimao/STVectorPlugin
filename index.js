/**
 * SillyTavern 向量管理插件
 * 作者: 梅川晓钡锌
 * 版本: 1.1.0
 *
 * 更新内容:
 * - 移除对 SillyTavern 内置向量 API 的依赖
 * - 支持多种外部 API 端点（OpenAI、Azure、自定义）
 * - 实现本地向量存储系统
 * - 添加 API 测试和向量管理功能
 */

(() => {
    'use strict';

    // 模块名称
    const MODULE_NAME = 'vector-manager';
    
    // 默认设置
    const defaultSettings = {
        // 向量查询设置
        vectorQuery: {
            enabled: true,
            apiEndpoint: 'openai', // openai, azure, custom
            customApiUrl: '',
            apiKey: '',
            model: 'text-embedding-ada-002',
            chunkSize: 512,
            overlap: 50,
            scoreThreshold: 0.7,
            queryMessageCount: 5,
            maxResults: 10,
            batchSize: 5,
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

    // 全局变量
    let context = null;
    let settings = null;
    let isModalOpen = false;

    /**
     * 获取或初始化设置
     */
    function getSettings() {
        if (!context.extensionSettings[MODULE_NAME]) {
            context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        }

        // 确保所有默认键存在
        const currentSettings = context.extensionSettings[MODULE_NAME];
        for (const key in defaultSettings) {
            if (currentSettings[key] === undefined) {
                currentSettings[key] = structuredClone(defaultSettings[key]);
            } else if (typeof defaultSettings[key] === 'object' && !Array.isArray(defaultSettings[key])) {
                for (const subKey in defaultSettings[key]) {
                    if (currentSettings[key][subKey] === undefined) {
                        currentSettings[key][subKey] = defaultSettings[key][subKey];
                    }
                }
            }
        }

        return context.extensionSettings[MODULE_NAME];
    }

    /**
     * 保存设置
     */
    function saveSettings() {
        context.saveSettingsDebounced();
    }

    /**
     * 显示通知
     */
    function showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `vector-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // 显示动画
        setTimeout(() => notification.classList.add('show'), 100);
        
        // 自动隐藏
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => document.body.removeChild(notification), 300);
        }, duration);
    }

    /**
     * 获取最近的聊天消息
     */
    function getRecentMessages(count) {
        if (!context.chat || context.chat.length === 0) {
            return [];
        }
        
        const messages = context.chat.slice(-count);
        return messages;
    }

    /**
     * 按类型筛选消息
     */
    function filterMessagesByType(messages, types) {
        return messages.filter(msg => {
            if (types.user && msg.is_user) return true;
            if (types.ai && !msg.is_user && !msg.is_system) return true;
            if (types.hidden && msg.is_hidden) return true;
            return false;
        });
    }

    /**
     * 提取文本内容
     */
    function extractTextContent(messages) {
        return messages.map(msg => {
            let text = msg.mes || '';
            // 移除HTML标签
            text = text.replace(/<[^>]*>/g, '');
            return {
                text: text.trim(),
                timestamp: msg.send_date,
                isUser: msg.is_user,
                name: msg.name || (msg.is_user ? 'User' : 'Assistant')
            };
        }).filter(item => item.text.length > 0);
    }

    /**
     * 文本分块
     */
    function splitIntoChunks(text, chunkSize, overlap) {
        const chunks = [];
        let start = 0;
        
        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            const chunk = text.substring(start, end);
            
            if (chunk.trim().length > 0) {
                chunks.push({
                    text: chunk.trim(),
                    start: start,
                    end: end
                });
            }
            
            start = end - overlap;
            if (start >= text.length) break;
        }
        
        return chunks;
    }

    /**
     * 获取API端点URL
     */
    function getApiEndpointUrl() {
        switch (settings.vectorQuery.apiEndpoint) {
            case 'openai':
                return 'https://api.openai.com/v1/embeddings';
            case 'azure':
                // Azure OpenAI 需要自定义端点
                return settings.vectorQuery.customApiUrl || 'https://your-resource.openai.azure.com/openai/deployments/your-deployment/embeddings?api-version=2023-05-15';
            case 'custom':
                return settings.vectorQuery.customApiUrl || 'https://api.openai.com/v1/embeddings';
            default:
                return 'https://api.openai.com/v1/embeddings';
        }
    }

    /**
     * 获取API请求头
     */
    function getApiHeaders(apiKey) {
        const headers = {
            'Content-Type': 'application/json'
        };

        switch (settings.vectorQuery.apiEndpoint) {
            case 'openai':
            case 'custom':
                headers['Authorization'] = `Bearer ${apiKey}`;
                break;
            case 'azure':
                headers['api-key'] = apiKey;
                break;
        }

        return headers;
    }

    /**
     * 获取文本向量嵌入
     */
    async function getTextEmbedding(text, apiKey, model) {
        try {
            const url = getApiEndpointUrl();
            const headers = getApiHeaders(apiKey);

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    input: text,
                    model: model || 'text-embedding-ada-002'
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 错误 ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            return result.data[0].embedding;
        } catch (error) {
            console.error('获取向量嵌入失败:', error);
            throw error;
        }
    }

    /**
     * 计算余弦相似度
     */
    function cosineSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length) {
            throw new Error('向量维度不匹配');
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * 向量查询 - 使用外部API
     */
    async function queryVectors(queryText, maxResults = 10) {
        try {
            if (!settings.vectorQuery.enabled) {
                return [];
            }

            if (!settings.vectorQuery.apiKey) {
                throw new Error('请先配置向量查询API Key');
            }

            // 获取查询文本的向量嵌入
            const queryEmbedding = await getTextEmbedding(
                queryText,
                settings.vectorQuery.apiKey,
                settings.vectorQuery.model
            );

            // 从本地存储的向量数据中搜索
            const storedVectors = getStoredVectors();
            if (storedVectors.length === 0) {
                if (settings.vectorQuery.notifySuccess) {
                    showNotification('没有找到已向量化的内容', 'warning');
                }
                return [];
            }

            // 计算相似度并排序
            const similarities = storedVectors.map(item => ({
                ...item,
                similarity: cosineSimilarity(queryEmbedding, item.embedding)
            }));

            // 按相似度排序并筛选
            const results = similarities
                .filter(item => item.similarity >= settings.vectorQuery.scoreThreshold)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, maxResults);

            if (settings.vectorQuery.notifySuccess && results.length > 0) {
                showNotification(`找到 ${results.length} 个相关结果`, 'success');
            }

            return results;
        } catch (error) {
            console.error('向量查询失败:', error);
            if (settings.vectorQuery.notifySuccess) {
                showNotification(`向量查询失败: ${error.message}`, 'error');
            }
            return [];
        }
    }

    /**
     * 获取本地存储的向量数据
     */
    function getStoredVectors() {
        const stored = localStorage.getItem(`${MODULE_NAME}_vectors`);
        return stored ? JSON.parse(stored) : [];
    }

    /**
     * 保存向量数据到本地存储
     */
    function saveVectorsToStorage(vectors) {
        const existing = getStoredVectors();
        const combined = [...existing, ...vectors];
        localStorage.setItem(`${MODULE_NAME}_vectors`, JSON.stringify(combined));
    }

    /**
     * 清空本地向量存储
     */
    function clearVectorStorage() {
        localStorage.removeItem(`${MODULE_NAME}_vectors`);
        showNotification('向量存储已清空', 'info');
    }

    /**
     * 批量获取文本向量嵌入
     */
    async function batchGetEmbeddings(texts, apiKey, model, batchSize = 5) {
        const embeddings = [];
        const url = getApiEndpointUrl();
        const headers = getApiHeaders(apiKey);

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        input: batch,
                        model: model || 'text-embedding-ada-002'
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API 错误 ${response.status}: ${errorText}`);
                }

                const result = await response.json();
                embeddings.push(...result.data.map(item => item.embedding));

                // 显示进度
                showNotification(`向量化进度: ${Math.min(i + batchSize, texts.length)}/${texts.length}`, 'info', 1000);

                // 避免API限制，添加延迟
                if (i + batchSize < texts.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(`批次 ${i}-${i + batchSize} 向量化失败:`, error);
                throw error;
            }
        }

        return embeddings;
    }

    /**
     * 插入向量 - 使用外部API和本地存储
     */
    async function insertVectors(chunks) {
        try {
            if (!settings.vectorQuery.apiKey) {
                throw new Error('请先配置向量查询API Key');
            }

            // 提取文本内容
            const texts = chunks.map(chunk => chunk.text);

            // 批量获取向量嵌入
            const embeddings = await batchGetEmbeddings(
                texts,
                settings.vectorQuery.apiKey,
                settings.vectorQuery.model,
                settings.vectorQuery.batchSize
            );

            // 创建向量数据对象
            const vectorData = chunks.map((chunk, index) => ({
                ...chunk,
                embedding: embeddings[index],
                timestamp: Date.now(),
                id: generateHash(chunk.text + Date.now())
            }));

            // 保存到本地存储
            saveVectorsToStorage(vectorData);

            return { success: true, count: vectorData.length };
        } catch (error) {
            console.error('向量插入失败:', error);
            showNotification(`向量插入失败: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * 测试向量API连接
     */
    async function testVectorAPI() {
        try {
            if (!settings.vectorQuery.apiKey) {
                showNotification('请先配置API Key', 'warning');
                return;
            }

            showNotification('正在测试API连接...', 'info');

            const testText = "这是一个测试文本";
            const embedding = await getTextEmbedding(
                testText,
                settings.vectorQuery.apiKey,
                settings.vectorQuery.model
            );

            if (embedding && embedding.length > 0) {
                showNotification(`API连接成功！向量维度: ${embedding.length}`, 'success');
            } else {
                showNotification('API连接失败：返回的向量为空', 'error');
            }
        } catch (error) {
            console.error('API测试失败:', error);
            showNotification(`API连接失败: ${error.message}`, 'error');
        }
    }

    /**
     * 显示向量统计信息
     */
    function showVectorStats() {
        const vectors = getStoredVectors();
        const totalVectors = vectors.length;

        if (totalVectors === 0) {
            showNotification('暂无向量数据', 'info');
            return;
        }

        const totalSize = JSON.stringify(vectors).length;
        const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);

        const oldestTimestamp = Math.min(...vectors.map(v => v.timestamp));
        const newestTimestamp = Math.max(...vectors.map(v => v.timestamp));

        const statsText = `
向量统计信息:
- 总向量数: ${totalVectors}
- 存储大小: ${sizeInMB} MB
- 最早创建: ${new Date(oldestTimestamp).toLocaleString()}
- 最近创建: ${new Date(newestTimestamp).toLocaleString()}
        `.trim();

        // 显示统计信息模态框
        showPreviewModal(statsText);
    }

    /**
     * Rerank API 调用
     */
    async function callRerankAPI(query, documents, apiKey, model) {
        if (!settings.rerank.enabled || !apiKey) {
            return documents;
        }
        
        try {
            const response = await fetch('https://api.cohere.ai/v1/rerank', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    query: query,
                    documents: documents.map(doc => doc.text),
                    top_n: settings.rerank.topN
                })
            });
            
            if (!response.ok) {
                throw new Error(`Rerank API 错误: ${response.status}`);
            }
            
            const result = await response.json();
            
            // 重新排序文档
            const rerankedDocs = result.results.map(item => ({
                ...documents[item.index],
                rerankScore: item.relevance_score
            }));
            
            if (settings.rerank.notify) {
                showNotification(`Rerank 完成，处理了 ${rerankedDocs.length} 个结果`, 'success');
            }
            
            return rerankedDocs;
        } catch (error) {
            console.error('Rerank 失败:', error);
            if (settings.rerank.notify) {
                showNotification(`Rerank 失败: ${error.message}`, 'error');
            }
            return documents;
        }
    }

    /**
     * 创建模态框HTML
     */
    function createModalHTML() {
        return `
            <div id="vector-manager-modal">
                <div class="vector-modal-content">
                    <div class="vector-modal-header">
                        <div class="vector-modal-title">向量管理插件</div>
                        <button class="vector-modal-close" onclick="closeVectorModal()">&times;</button>
                    </div>

                    <div class="vector-tabs">
                        <button class="vector-tab active" data-tab="query">向量查询</button>
                        <button class="vector-tab" data-tab="rerank">Rerank</button>
                        <button class="vector-tab" data-tab="injection">注入设置</button>
                        <button class="vector-tab" data-tab="vectorization">向量化</button>
                    </div>

                    <div class="vector-modal-body">
                        <!-- 向量查询标签页 -->
                        <div id="query-tab" class="vector-tab-content active">
                            <div class="vector-form-group">
                                <label class="vector-form-label">
                                    <input type="checkbox" id="query-enabled"> 启用向量查询
                                </label>
                                <small>开启后将使用外部API进行向量查询</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="query-api-endpoint">API 端点:</label>
                                <select id="query-api-endpoint" class="vector-form-select">
                                    <option value="openai">OpenAI (推荐)</option>
                                    <option value="azure">Azure OpenAI</option>
                                    <option value="custom">自定义端点</option>
                                </select>
                                <small>选择向量化服务提供商</small>
                            </div>

                            <div class="vector-form-group" id="custom-endpoint-group" style="display: none;">
                                <label class="vector-form-label" for="custom-api-url">自定义API地址:</label>
                                <input type="text" id="custom-api-url" class="vector-form-input" placeholder="https://your-api-endpoint.com/v1/embeddings">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="query-api-key">API Key:</label>
                                <input type="password" id="query-api-key" class="vector-form-input" placeholder="输入向量化API密钥">
                                <small>请确保API Key有足够的配额</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="query-model">模型:</label>
                                <input type="text" id="query-model" class="vector-form-input" placeholder="text-embedding-ada-002">
                                <small>推荐使用 text-embedding-3-small 或 text-embedding-ada-002</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label">
                                    <input type="checkbox" id="query-notify"> 查询成功通知
                                </label>
                                <small>显示向量查询结果的通知消息</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="chunk-size">块大小:</label>
                                <input type="number" id="chunk-size" class="vector-form-input" min="100" max="2000" value="512">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="overlap-size">重叠大小:</label>
                                <input type="number" id="overlap-size" class="vector-form-input" min="0" max="500" value="50">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="score-threshold">分数阈值:</label>
                                <input type="number" id="score-threshold" class="vector-form-input" min="0" max="1" step="0.1" value="0.7">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="query-message-count">查询消息数:</label>
                                <input type="number" id="query-message-count" class="vector-form-input" min="1" max="50" value="5">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="max-results">最大结果数:</label>
                                <input type="number" id="max-results" class="vector-form-input" min="1" max="100" value="10">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="batch-size">批处理大小:</label>
                                <input type="number" id="batch-size" class="vector-form-input" min="1" max="20" value="5">
                                <small style="color: #666;">每次API调用处理的文本数量</small>
                            </div>

                            <div class="vector-form-group">
                                <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                                    <button class="vector-btn" onclick="testVectorAPI()">
                                        🔗 测试API连接
                                    </button>
                                    <button class="vector-btn" onclick="showVectorStats()">
                                        📊 查看向量统计
                                    </button>
                                    <button class="vector-btn" onclick="clearVectorStorage()"
                                            style="background-color: #dc3545; color: white; border-color: #dc3545;">
                                        🗑️ 清空存储
                                    </button>
                                </div>
                                <small>建议先测试API连接确保配置正确</small>
                            </div>
                        </div>

                        <!-- Rerank标签页 -->
                        <div id="rerank-tab" class="vector-tab-content">
                            <div class="vector-form-group">
                                <label class="vector-form-label">
                                    <input type="checkbox" id="rerank-enabled"> 启用Rerank
                                </label>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label">
                                    <input type="checkbox" id="rerank-notify"> Rerank通知
                                </label>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="rerank-api-key">API Key:</label>
                                <input type="password" id="rerank-api-key" class="vector-form-input" placeholder="输入Rerank API密钥">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="rerank-model">模型:</label>
                                <input type="text" id="rerank-model" class="vector-form-input" placeholder="rerank-multilingual-v2.0">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="rerank-top-n">Rerank Top N:</label>
                                <input type="number" id="rerank-top-n" class="vector-form-input" min="1" max="20" value="5">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="hybrid-weight">混合权重:</label>
                                <input type="number" id="hybrid-weight" class="vector-form-input" min="0" max="1" step="0.1" value="0.5">
                            </div>
                        </div>

                        <!-- 注入设置标签页 -->
                        <div id="injection-tab" class="vector-tab-content">
                            <div class="vector-form-group">
                                <label class="vector-form-label" for="injection-template">注入提示词模板:</label>
                                <textarea id="injection-template" class="vector-form-textarea" placeholder="相关内容：\n{{text}}"></textarea>
                                <small>使用 {{text}} 作为内容占位符</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="injection-depth">注入深度:</label>
                                <input type="number" id="injection-depth" class="vector-form-input" min="1" max="20" value="1">
                                <small>在聊天历史中的注入位置，1表示最新消息前</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="role-type">注入角色类型:</label>
                                <select id="role-type" class="vector-form-select">
                                    <option value="system">系统消息</option>
                                    <option value="character">角色消息</option>
                                    <option value="model">模型消息</option>
                                </select>
                                <small>选择注入内容的消息类型</small>
                            </div>
                        </div>

                        <!-- 向量化标签页 -->
                        <div id="vectorization-tab" class="vector-tab-content">
                            <div class="vector-form-group">
                                <label class="vector-form-label">
                                    <input type="checkbox" id="include-chat-messages"> 包含聊天消息
                                </label>
                                <small>启用后将处理聊天记录中的消息</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="layer-range">聊天层数范围:</label>
                                <input type="text" id="layer-range" class="vector-form-input" placeholder="1-10" value="1-10">
                                <small>格式: 开始-结束，如 "1-10" 表示最近10条消息</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label">消息类型:</label>
                                <div style="display: flex; flex-direction: column; gap: 8px;">
                                    <label class="vector-form-label"><input type="checkbox" id="include-user"> 用户消息</label>
                                    <label class="vector-form-label"><input type="checkbox" id="include-ai"> AI消息</label>
                                    <label class="vector-form-label"><input type="checkbox" id="include-hidden"> 隐藏消息</label>
                                </div>
                            </div>

                            <div class="vector-form-group">
                                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                                    <button class="vector-btn vector-btn-success" onclick="startVectorization()">
                                        🚀 开始向量化
                                    </button>
                                    <button class="vector-btn" onclick="showPreview()">
                                        👁️ 预览内容
                                    </button>
                                </div>
                                <small>预览可以查看将要向量化的内容</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label">向量结果列表:</label>
                                <div id="vector-results" class="vector-results">
                                    <!-- 结果将在这里显示 -->
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="vector-modal-footer">
                        <button class="vector-btn" onclick="resetVectorSettings()">重置</button>
                        <button class="vector-btn vector-btn-primary" onclick="saveVectorSettings()">保存</button>
                        <button class="vector-btn" onclick="closeVectorModal()">关闭</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 显示模态框
     */
    function showModal() {
        if (isModalOpen) return;

        // 创建模态框
        const modalHTML = createModalHTML();
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // 绑定事件
        bindModalEvents();

        // 加载设置
        loadSettingsToForm();

        // 显示模态框
        const modal = document.getElementById('vector-manager-modal');
        modal.classList.add('show');
        isModalOpen = true;
    }

    /**
     * 关闭模态框
     */
    function closeModal() {
        const modal = document.getElementById('vector-manager-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(modal);
                isModalOpen = false;
            }, 300);
        }
    }

    /**
     * 切换自定义端点输入框显示
     */
    function toggleCustomEndpointInput() {
        const endpoint = document.getElementById('query-api-endpoint').value;
        const customGroup = document.getElementById('custom-endpoint-group');

        if (endpoint === 'custom' || endpoint === 'azure') {
            customGroup.style.display = 'block';
        } else {
            customGroup.style.display = 'none';
        }
    }

    /**
     * 绑定模态框事件
     */
    function bindModalEvents() {
        // 标签页切换
        const tabs = document.querySelectorAll('.vector-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                switchTab(targetTab);
            });
        });

        // API端点切换事件
        const endpointSelect = document.getElementById('query-api-endpoint');
        if (endpointSelect) {
            endpointSelect.addEventListener('change', toggleCustomEndpointInput);
        }

        // 点击模态框外部关闭
        const modal = document.getElementById('vector-manager-modal');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }

    /**
     * 切换标签页
     */
    function switchTab(tabName) {
        // 移除所有活动状态
        document.querySelectorAll('.vector-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.vector-tab-content').forEach(content => {
            content.classList.remove('active');
        });

        // 激活目标标签页
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    /**
     * 加载设置到表单
     */
    function loadSettingsToForm() {
        const s = settings;

        // 向量查询设置
        document.getElementById('query-enabled').checked = s.vectorQuery.enabled;
        document.getElementById('query-api-endpoint').value = s.vectorQuery.apiEndpoint;
        document.getElementById('custom-api-url').value = s.vectorQuery.customApiUrl;
        document.getElementById('query-api-key').value = s.vectorQuery.apiKey;
        document.getElementById('query-model').value = s.vectorQuery.model;
        document.getElementById('query-notify').checked = s.vectorQuery.notifySuccess;
        document.getElementById('chunk-size').value = s.vectorQuery.chunkSize;
        document.getElementById('overlap-size').value = s.vectorQuery.overlap;
        document.getElementById('score-threshold').value = s.vectorQuery.scoreThreshold;
        document.getElementById('query-message-count').value = s.vectorQuery.queryMessageCount;
        document.getElementById('max-results').value = s.vectorQuery.maxResults;
        document.getElementById('batch-size').value = s.vectorQuery.batchSize;

        // 显示/隐藏自定义端点输入框
        toggleCustomEndpointInput();

        // Rerank设置
        document.getElementById('rerank-enabled').checked = s.rerank.enabled;
        document.getElementById('rerank-notify').checked = s.rerank.notify;
        document.getElementById('rerank-api-key').value = s.rerank.apiKey;
        document.getElementById('rerank-model').value = s.rerank.model;
        document.getElementById('rerank-top-n').value = s.rerank.topN;
        document.getElementById('hybrid-weight').value = s.rerank.hybridWeight;

        // 注入设置
        document.getElementById('injection-template').value = s.injection.template;
        document.getElementById('injection-depth').value = s.injection.depth;
        document.getElementById('role-type').value = s.injection.roleType;

        // 向量化设置
        document.getElementById('include-chat-messages').checked = s.vectorization.includeChatMessages;
        document.getElementById('layer-range').value = s.vectorization.layerRange;
        document.getElementById('include-user').checked = s.vectorization.messageTypes.user;
        document.getElementById('include-ai').checked = s.vectorization.messageTypes.ai;
        document.getElementById('include-hidden').checked = s.vectorization.messageTypes.hidden;
    }

    /**
     * 从表单保存设置
     */
    function saveSettingsFromForm() {
        // 向量查询设置
        settings.vectorQuery.enabled = document.getElementById('query-enabled').checked;
        settings.vectorQuery.apiEndpoint = document.getElementById('query-api-endpoint').value;
        settings.vectorQuery.customApiUrl = document.getElementById('custom-api-url').value;
        settings.vectorQuery.apiKey = document.getElementById('query-api-key').value;
        settings.vectorQuery.model = document.getElementById('query-model').value;
        settings.vectorQuery.notifySuccess = document.getElementById('query-notify').checked;
        settings.vectorQuery.chunkSize = parseInt(document.getElementById('chunk-size').value);
        settings.vectorQuery.overlap = parseInt(document.getElementById('overlap-size').value);
        settings.vectorQuery.scoreThreshold = parseFloat(document.getElementById('score-threshold').value);
        settings.vectorQuery.queryMessageCount = parseInt(document.getElementById('query-message-count').value);
        settings.vectorQuery.maxResults = parseInt(document.getElementById('max-results').value);
        settings.vectorQuery.batchSize = parseInt(document.getElementById('batch-size').value);

        // Rerank设置
        settings.rerank.enabled = document.getElementById('rerank-enabled').checked;
        settings.rerank.notify = document.getElementById('rerank-notify').checked;
        settings.rerank.apiKey = document.getElementById('rerank-api-key').value;
        settings.rerank.model = document.getElementById('rerank-model').value;
        settings.rerank.topN = parseInt(document.getElementById('rerank-top-n').value);
        settings.rerank.hybridWeight = parseFloat(document.getElementById('hybrid-weight').value);

        // 注入设置
        settings.injection.template = document.getElementById('injection-template').value;
        settings.injection.depth = parseInt(document.getElementById('injection-depth').value);
        settings.injection.roleType = document.getElementById('role-type').value;

        // 向量化设置
        settings.vectorization.includeChatMessages = document.getElementById('include-chat-messages').checked;
        settings.vectorization.layerRange = document.getElementById('layer-range').value;
        settings.vectorization.messageTypes.user = document.getElementById('include-user').checked;
        settings.vectorization.messageTypes.ai = document.getElementById('include-ai').checked;
        settings.vectorization.messageTypes.hidden = document.getElementById('include-hidden').checked;

        saveSettings();
        showNotification('设置已保存', 'success');
    }

    /**
     * 重置设置
     */
    function resetSettings() {
        context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        settings = getSettings();
        loadSettingsToForm();
        showNotification('设置已重置', 'info');
    }

    /**
     * 解析层数范围
     */
    function parseLayerRange(rangeString) {
        const match = rangeString.match(/^(\d+)-(\d+)$/);
        if (!match) {
            throw new Error('层数范围格式错误，应为 "开始-结束" 格式，如 "1-10"');
        }

        const start = parseInt(match[1]);
        const end = parseInt(match[2]);

        if (start > end) {
            throw new Error('开始层数不能大于结束层数');
        }

        return { start, end };
    }

    /**
     * 按层数筛选消息
     */
    function filterByLayer(messages, startLayer, endLayer) {
        const totalMessages = messages.length;
        const actualStart = Math.max(0, totalMessages - endLayer);
        const actualEnd = Math.max(0, totalMessages - startLayer + 1);

        return messages.slice(actualStart, actualEnd);
    }

    /**
     * 开始向量化
     */
    async function startVectorization() {
        try {
            if (!settings.vectorization.includeChatMessages) {
                showNotification('请先勾选聊天消息', 'warning');
                return;
            }

            const { start, end } = parseLayerRange(settings.vectorization.layerRange);
            const messages = getRecentMessages(end);

            if (messages.length === 0) {
                showNotification('没有找到聊天消息', 'warning');
                return;
            }

            // 按层数筛选
            const layerFiltered = filterByLayer(messages, start, end);

            // 按类型筛选
            const typeFiltered = filterMessagesByType(layerFiltered, settings.vectorization.messageTypes);

            if (typeFiltered.length === 0) {
                showNotification('根据筛选条件没有找到消息', 'warning');
                return;
            }

            // 提取文本内容
            const textContent = extractTextContent(typeFiltered);

            // 分块处理
            const allChunks = [];
            textContent.forEach((item, index) => {
                const chunks = splitIntoChunks(item.text, settings.vectorQuery.chunkSize, settings.vectorQuery.overlap);
                chunks.forEach((chunk, chunkIndex) => {
                    allChunks.push({
                        text: chunk.text,
                        hash: generateHash(chunk.text),
                        source: `message_${index}_chunk_${chunkIndex}`,
                        timestamp: item.timestamp,
                        isUser: item.isUser,
                        name: item.name
                    });
                });
            });

            if (allChunks.length === 0) {
                showNotification('没有生成有效的文本块', 'warning');
                return;
            }

            showNotification(`开始向量化 ${allChunks.length} 个文本块...`, 'info');

            // 批量向量化
            await insertVectors(allChunks);

            showNotification(`向量化完成！处理了 ${allChunks.length} 个文本块`, 'success');

            // 更新结果列表
            updateResultsList(allChunks);

        } catch (error) {
            console.error('向量化失败:', error);
            showNotification(`向量化失败: ${error.message}`, 'error');
        }
    }

    /**
     * 生成简单哈希
     */
    function generateHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return hash.toString(36);
    }

    /**
     * 更新结果列表
     */
    function updateResultsList(chunks) {
        const resultsContainer = document.getElementById('vector-results');
        if (!resultsContainer) return;

        resultsContainer.innerHTML = '';

        chunks.forEach((chunk, index) => {
            const item = document.createElement('div');
            item.className = 'vector-result-item';
            item.innerHTML = `
                <div class="vector-result-score">块 ${index + 1}</div>
                <div class="vector-result-text">${chunk.text.substring(0, 100)}${chunk.text.length > 100 ? '...' : ''}</div>
                <div style="font-size: 11px; color: #666; margin-top: 5px;">
                    来源: ${chunk.name} | 时间: ${new Date(chunk.timestamp).toLocaleString()}
                </div>
            `;
            resultsContainer.appendChild(item);
        });
    }

    /**
     * 显示预览
     */
    function showPreview() {
        try {
            if (!settings.vectorization.includeChatMessages) {
                showNotification('请先勾选聊天消息', 'warning');
                return;
            }

            const { start, end } = parseLayerRange(settings.vectorization.layerRange);
            const messages = getRecentMessages(end);

            if (messages.length === 0) {
                showNotification('没有找到聊天消息', 'warning');
                return;
            }

            // 按层数筛选
            const layerFiltered = filterByLayer(messages, start, end);

            // 按类型筛选
            const typeFiltered = filterMessagesByType(layerFiltered, settings.vectorization.messageTypes);

            if (typeFiltered.length === 0) {
                showNotification('根据筛选条件没有找到消息', 'warning');
                return;
            }

            // 提取文本内容
            const textContent = extractTextContent(typeFiltered);

            // 生成预览文本
            let previewText = `预览内容 (共 ${textContent.length} 条消息):\n\n`;
            textContent.forEach((item, index) => {
                previewText += `${index + 1}. [${item.name}] ${item.text}\n\n`;
            });

            // 显示预览模态框
            showPreviewModal(previewText);

        } catch (error) {
            console.error('预览失败:', error);
            showNotification(`预览失败: ${error.message}`, 'error');
        }
    }

    /**
     * 显示预览模态框
     */
    function showPreviewModal(content) {
        const previewHTML = `
            <div class="vector-preview-modal" id="vector-preview-modal" style="display: flex;">
                <div class="vector-preview-content">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h3>内容预览</h3>
                        <button class="vector-btn" onclick="closePreviewModal()">关闭</button>
                    </div>
                    <div class="vector-preview-text">${content}</div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', previewHTML);

        // 点击外部关闭
        document.getElementById('vector-preview-modal').addEventListener('click', (e) => {
            if (e.target.id === 'vector-preview-modal') {
                closePreviewModal();
            }
        });
    }

    /**
     * 关闭预览模态框
     */
    function closePreviewModal() {
        const modal = document.getElementById('vector-preview-modal');
        if (modal) {
            document.body.removeChild(modal);
        }
    }

    /**
     * 添加设置面板按钮
     */
    function addSettingsButton() {
        const settingsButton = document.createElement('div');
        settingsButton.id = 'vector-manager-button';
        settingsButton.className = 'list-group-item flex-container flexGap5';
        settingsButton.innerHTML = `
            <div class="fa-solid fa-vector-square extensionsMenuExtensionIcon"></div>
            <span>向量管理插件</span>
        `;
        settingsButton.style.cursor = 'pointer';
        settingsButton.addEventListener('click', showModal);

        // 添加到扩展设置面板
        const extensionsMenu = document.getElementById('extensions_settings');
        if (extensionsMenu) {
            extensionsMenu.appendChild(settingsButton);
        }
    }

    /**
     * 扩展初始化
     */
    function initExtension() {
        // 获取SillyTavern上下文
        context = SillyTavern.getContext();

        if (!context) {
            console.error('无法获取SillyTavern上下文');
            return;
        }

        // 初始化设置
        settings = getSettings();

        // 添加设置按钮
        addSettingsButton();

        console.log('向量管理插件已初始化');
    }

    // 全局函数，供HTML调用
    window.closeVectorModal = closeModal;
    window.saveVectorSettings = saveSettingsFromForm;
    window.resetVectorSettings = resetSettings;
    window.startVectorization = startVectorization;
    window.showPreview = showPreview;
    window.closePreviewModal = closePreviewModal;
    window.testVectorAPI = testVectorAPI;
    window.showVectorStats = showVectorStats;
    window.clearVectorStorage = clearVectorStorage;

    // 等待SillyTavern加载完成后初始化
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        initExtension();
    } else {
        // 如果SillyTavern还未加载，等待加载完成
        document.addEventListener('DOMContentLoaded', () => {
            const checkST = setInterval(() => {
                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    clearInterval(checkST);
                    initExtension();
                }
            }, 100);
        });
    }

})();
