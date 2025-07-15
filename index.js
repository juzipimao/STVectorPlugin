/**
 * SillyTavern 向量管理插件
 * 作者: 梅川晓钡锌
 * 版本: 1.0.0
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
     * 向量查询
     */
    async function queryVectors(text, maxResults = 10) {
        try {
            const response = await fetch('/api/vector/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    top_k: maxResults,
                    threshold: settings.vectorQuery.scoreThreshold
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result.results || [];
        } catch (error) {
            console.error('向量查询失败:', error);
            if (settings.vectorQuery.notifySuccess) {
                showNotification(`向量查询失败: ${error.message}`, 'error');
            }
            return [];
        }
    }

    /**
     * 插入向量
     */
    async function insertVectors(chunks) {
        try {
            const response = await fetch('/api/vector/insert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chunks })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('向量插入失败:', error);
            showNotification(`向量插入失败: ${error.message}`, 'error');
            throw error;
        }
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
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="query-api-key">API Key:</label>
                                <input type="password" id="query-api-key" class="vector-form-input" placeholder="输入向量化API密钥">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="query-model">模型:</label>
                                <input type="text" id="query-model" class="vector-form-input" placeholder="text-embedding-ada-002">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label">
                                    <input type="checkbox" id="query-notify"> 查询成功通知
                                </label>
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
                                <label class="vector-form-label" for="injection-template">注入提示词:</label>
                                <textarea id="injection-template" class="vector-form-textarea" placeholder="相关内容：\n{{text}}"></textarea>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="injection-depth">聊天内@深度:</label>
                                <input type="number" id="injection-depth" class="vector-form-input" min="1" max="20" value="1">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="role-type">作为:</label>
                                <select id="role-type" class="vector-form-select">
                                    <option value="system">系统</option>
                                    <option value="character">角色</option>
                                    <option value="model">模型</option>
                                </select>
                            </div>
                        </div>

                        <!-- 向量化标签页 -->
                        <div id="vectorization-tab" class="vector-tab-content">
                            <div class="vector-form-group">
                                <label class="vector-form-label">
                                    <input type="checkbox" id="include-chat-messages"> 勾选聊天消息
                                </label>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="layer-range">聊天层数:</label>
                                <input type="text" id="layer-range" class="vector-form-input" placeholder="1-10" value="1-10">
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label">消息类型:</label>
                                <div>
                                    <label><input type="checkbox" id="include-user"> 用户消息</label>
                                    <label><input type="checkbox" id="include-ai"> AI消息</label>
                                    <label><input type="checkbox" id="include-hidden"> 隐藏消息</label>
                                </div>
                            </div>

                            <div class="vector-form-group">
                                <button class="vector-btn vector-btn-success" onclick="startVectorization()">开始向量化</button>
                                <button class="vector-btn" onclick="showPreview()">预览</button>
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
        document.getElementById('query-api-key').value = s.vectorQuery.apiKey;
        document.getElementById('query-model').value = s.vectorQuery.model;
        document.getElementById('query-notify').checked = s.vectorQuery.notifySuccess;
        document.getElementById('chunk-size').value = s.vectorQuery.chunkSize;
        document.getElementById('overlap-size').value = s.vectorQuery.overlap;
        document.getElementById('score-threshold').value = s.vectorQuery.scoreThreshold;
        document.getElementById('query-message-count').value = s.vectorQuery.queryMessageCount;
        document.getElementById('max-results').value = s.vectorQuery.maxResults;

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
        settings.vectorQuery.apiKey = document.getElementById('query-api-key').value;
        settings.vectorQuery.model = document.getElementById('query-model').value;
        settings.vectorQuery.notifySuccess = document.getElementById('query-notify').checked;
        settings.vectorQuery.chunkSize = parseInt(document.getElementById('chunk-size').value);
        settings.vectorQuery.overlap = parseInt(document.getElementById('overlap-size').value);
        settings.vectorQuery.scoreThreshold = parseFloat(document.getElementById('score-threshold').value);
        settings.vectorQuery.queryMessageCount = parseInt(document.getElementById('query-message-count').value);
        settings.vectorQuery.maxResults = parseInt(document.getElementById('max-results').value);

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
