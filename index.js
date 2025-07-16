/**
 * SillyTavern 向量管理插件
 * 作者: 梅川晓钡锌
 * 版本: 2.0.0
 *
 * 更新内容:
 * - 完全使用 SillyTavern 内置向量 API
 * - 移除外部 API 依赖，使用项目内置向量系统
 * - 支持多种向量源（transformers, openai, cohere等）
 * - 实现基于集合的向量管理
 * - 优化向量存储和查询性能
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
            layerStart: 1,
            layerEnd: 10,
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

    // 将函数暴露到全局作用域，供HTML调用
    window.testVectorAPI = null;
    window.showVectorStats = null;
    window.clearVectorStorage = null;
    window.closeVectorModal = null;
    window.saveVectorSettings = null;
    window.resetVectorSettings = null;
    window.startVectorization = null;
    window.showPreview = null;
    window.debugContextState = null;
    window.debugDetailedIssues = null;

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
     * 智能检测消息类型（处理异常标记情况）
     */
    function detectMessageType(msg) {
        // 检查是否是特殊系统消息
        const isSpecialSystemMessage = msg.extra?.type && [
            'help', 'welcome', 'empty', 'generic', 'narrator',
            'comment', 'slash_commands', 'formatting', 'hotkeys',
            'macros', 'welcome_prompt', 'assistant_note'
        ].includes(msg.extra.type);

        if (isSpecialSystemMessage) {
            return 'special_system';
        }

        // 标准情况判断
        if (msg.is_user === true) {
            return 'user';
        }

        if (msg.is_user === false && msg.is_system !== true) {
            return 'ai';
        }

        if (msg.is_system === true && msg.is_user !== true) {
            // 异常情况：所有消息都被标记为is_system: true
            // 通过名称来判断消息类型
            const name = msg.name?.toLowerCase() || '';

            // 常见的用户名称模式
            const userNamePatterns = ['云', 'user', '用户', 'human', 'me'];
            const isUserByName = userNamePatterns.some(pattern =>
                name === pattern.toLowerCase() || name.includes(pattern.toLowerCase())
            );

            if (isUserByName) {
                return 'user_abnormal';
            } else if (msg.name && msg.name.trim()) {
                // 有名称且不是用户名称，可能是AI
                return 'ai_abnormal';
            }
        }

        return 'unknown';
    }

    /**
     * 按类型筛选消息
     */
    function filterMessagesByType(messages, types) {
        console.log('向量插件: 开始筛选消息，筛选条件:', types);
        console.log('向量插件: 待筛选消息数量:', messages.length);

        const filtered = messages.filter(msg => {
            // 使用智能检测函数
            const detectedType = detectMessageType(msg);

            // 调试每条消息的属性
            const msgInfo = {
                name: msg.name,
                is_user: msg.is_user,
                is_system: msg.is_system,
                is_hidden: msg.is_hidden,
                extra_type: msg.extra?.type,
                detected_type: detectedType,
                mes: msg.mes ? msg.mes.substring(0, 50) + '...' : '(无内容)'
            };

            let shouldInclude = false;
            let reason = '';

            // 根据检测到的类型和用户选择进行筛选
            if (types.user && (detectedType === 'user' || detectedType === 'user_abnormal')) {
                shouldInclude = true;
                reason = detectedType === 'user_abnormal' ? '用户消息(异常标记)' : '用户消息';
            }
            else if (types.ai && (detectedType === 'ai' || detectedType === 'ai_abnormal')) {
                shouldInclude = true;
                reason = detectedType === 'ai_abnormal' ? 'AI消息(异常标记)' : 'AI消息';
            }
            else if (types.hidden && msg.is_hidden === true) {
                shouldInclude = true;
                reason = '隐藏消息';
            }

            console.log(`向量插件: 消息筛选 - ${shouldInclude ? '✓' : '✗'} [${reason || '不匹配'}]`, msgInfo);

            return shouldInclude;
        });

        console.log(`向量插件: 筛选完成，筛选后消息数量: ${filtered.length}`);
        return filtered;
    }

    /**
     * 提取文本内容
     */
    function extractTextContent(messages) {
        console.log('向量插件: 开始提取文本内容，消息数量:', messages.length);

        const extracted = messages.map((msg, index) => {
            let text = msg.mes || '';
            // 移除HTML标签
            text = text.replace(/<[^>]*>/g, '');

            const result = {
                text: text.trim(),
                timestamp: msg.send_date,
                isUser: msg.is_user,
                name: msg.name || (msg.is_user ? 'User' : 'Assistant')
            };

            console.log(`向量插件: 提取文本 ${index + 1} - [${result.name}] ${result.isUser ? '(用户)' : '(AI)'}: ${result.text.substring(0, 100)}${result.text.length > 100 ? '...' : ''}`);

            return result;
        }).filter(item => {
            const hasText = item.text.length > 0;
            if (!hasText) {
                console.log('向量插件: 过滤空文本消息:', item.name);
            }
            return hasText;
        });

        console.log(`向量插件: 文本提取完成，有效消息数量: ${extracted.length}`);
        return extracted;
    }

    /**
     * 文本分块
     */
    function splitIntoChunks(text, chunkSize, overlap) {
        // 参数验证
        if (!text || typeof text !== 'string') {
            console.warn('splitIntoChunks: 无效的文本输入');
            return [];
        }

        if (chunkSize <= 0) {
            console.warn('splitIntoChunks: chunkSize 必须大于 0');
            return [{ text: text.trim(), start: 0, end: text.length }];
        }

        if (overlap < 0) {
            console.warn('splitIntoChunks: overlap 不能为负数，设置为 0');
            overlap = 0;
        }

        // 确保 overlap 小于 chunkSize，防止无限循环
        if (overlap >= chunkSize) {
            console.warn(`splitIntoChunks: overlap (${overlap}) 必须小于 chunkSize (${chunkSize})，自动调整为 ${Math.floor(chunkSize * 0.5)}`);
            overlap = Math.floor(chunkSize * 0.5);
        }

        const chunks = [];
        let start = 0;
        let iterationCount = 0;
        const maxIterations = Math.ceil(text.length / (chunkSize - overlap)) + 10; // 安全上限

        while (start < text.length && iterationCount < maxIterations) {
            iterationCount++;

            const end = Math.min(start + chunkSize, text.length);
            const chunk = text.substring(start, end);

            if (chunk.trim().length > 0) {
                chunks.push({
                    text: chunk.trim(),
                    start: start,
                    end: end
                });
            }

            // 计算下一个起始位置
            const nextStart = start + chunkSize - overlap;

            // 确保进度，防止无限循环
            if (nextStart <= start) {
                console.warn('splitIntoChunks: 检测到潜在的无限循环，强制步进');
                start = start + Math.max(1, Math.floor(chunkSize / 2));
            } else {
                start = nextStart;
            }

            // 如果剩余文本太短，直接处理完毕
            if (text.length - start < overlap) {
                break;
            }
        }

        // 检查是否因为迭代次数限制而退出
        if (iterationCount >= maxIterations) {
            console.error('splitIntoChunks: 达到最大迭代次数限制，可能存在无限循环');
        }

        return chunks;
    }

    /**
     * 获取当前集合ID
     */
    function getCollectionId() {
        const currentCharId = getCurrentCharacterId();
        const currentChatId = getCurrentChatId();

        if (currentCharId && currentChatId) {
            return `char_${currentCharId}_chat_${currentChatId}`;
        } else if (currentCharId) {
            return `char_${currentCharId}`;
        } else {
            return 'default_collection';
        }
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
     * 获取文本向量嵌入（外部API）
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
     * 批量获取文本向量嵌入（外部API）
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
     * 向量查询 - 混合模式：外部API获取embedding + 内置API查询
     */
    async function queryVectors(queryText, maxResults = 10) {
        try {
            if (!settings.vectorQuery.enabled) {
                return [];
            }

            if (!settings.vectorQuery.apiKey) {
                throw new Error('请先配置向量查询API Key');
            }

            console.log('向量插件: 开始混合模式向量查询');
            console.log('查询文本:', queryText);

            // 1. 使用外部API获取查询文本的向量嵌入
            console.log('步骤1: 使用外部API获取查询embedding');
            const queryEmbedding = await getTextEmbedding(
                queryText,
                settings.vectorQuery.apiKey,
                settings.vectorQuery.model
            );
            console.log('查询embedding获取成功，维度:', queryEmbedding.length);

            // 2. 使用内置API进行向量查询
            console.log('步骤2: 使用内置API进行向量查询');
            const collectionId = getCollectionId();

            // 为查询创建临时的embeddings映射
            const queryEmbeddingsMap = {};
            queryEmbeddingsMap[queryText] = queryEmbedding;

            const response = await fetch('/api/vector/query', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: collectionId,
                    searchText: queryText, // 使用文本而不是embedding
                    topK: maxResults || settings.vectorQuery.maxResults,
                    threshold: settings.vectorQuery.scoreThreshold,
                    source: 'webllm', // 使用webllm源
                    embeddings: queryEmbeddingsMap // 传递查询文本的embedding
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`向量查询API错误 ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            const results = result.metadata || [];

            console.log('向量查询完成，结果数量:', results.length);

            if (settings.vectorQuery.notifySuccess && results.length > 0) {
                showNotification(`找到 ${results.length} 个相关结果`, 'success');
            } else if (results.length === 0) {
                if (settings.vectorQuery.notifySuccess) {
                    showNotification('没有找到相关内容', 'warning');
                }
            }

            return results.map(item => ({
                text: item.text,
                hash: item.hash,
                index: item.index,
                timestamp: item.timestamp,
                similarity: item.score || 0
            }));
        } catch (error) {
            console.error('向量查询失败:', error);
            if (settings.vectorQuery.notifySuccess) {
                showNotification(`向量查询失败: ${error.message}`, 'error');
            }
            return [];
        }
    }

    /**
     * 调试函数：检查当前上下文状态
     */
    function debugContextState() {
        console.log('=== 向量插件上下文调试信息 ===');
        console.log('context:', context);
        console.log('context.characterId:', context.characterId);
        console.log('context.characters:', context.characters);
        console.log('context.chat:', context.chat);
        console.log('context.chatId:', context.chatId);

        // 尝试直接访问全局变量
        if (typeof window !== 'undefined' && window.SillyTavern) {
            const globalContext = window.SillyTavern.getContext();
            console.log('全局上下文 characterId:', globalContext.characterId);
        }
    }

    /**
     * 详细调试函数：分析层数范围和向量数据库问题
     */
    function debugDetailedIssues() {
        console.log('=== 详细问题调试 ===');

        // 1. 层数范围计算调试
        const startLayer = settings.vectorization.layerStart;
        const endLayer = settings.vectorization.layerEnd;
        const totalMessages = context.chat ? context.chat.length : 0;

        console.log('--- 层数范围计算调试 ---');
        console.log('用户输入层数范围:', `${startLayer}-${endLayer}`);
        console.log('总消息数:', totalMessages);

        if (totalMessages > 0) {
            // 使用修复后的计算逻辑
            const startIndex = Math.max(0, startLayer - 1);
            const endIndex = Math.min(totalMessages, endLayer);
            console.log('修复后的索引范围:', `${startIndex}-${endIndex}`);
            console.log('实际获取的消息数量:', endIndex - startIndex);
            console.log('期望获取的消息数量:', Math.min(endLayer - startLayer + 1, totalMessages));

            // 显示具体的消息信息
            if (context.chat && context.chat.length > 0) {
                const messages = context.chat.slice(startIndex, endIndex);
                console.log('获取到的消息示例:');
                messages.slice(0, 3).forEach((msg, idx) => {
                    console.log(`  消息${startIndex + idx + 1}: ${msg.mes ? msg.mes.substring(0, 50) + '...' : '(空消息)'}`);
                });
                if (messages.length > 3) {
                    console.log(`  ... 还有 ${messages.length - 3} 条消息`);
                }
            }
        }

        // 2. 向量数据库调试
        console.log('--- 向量数据库调试 ---');
        const currentCharId = getCurrentCharacterId();
        const currentChatId = getCurrentChatId();
        console.log('当前角色ID:', currentCharId);
        console.log('当前聊天ID:', currentChatId);

        if (currentCharId && context.characters[currentCharId]) {
            const character = context.characters[currentCharId];
            console.log('角色数据存在:', !!character);
            console.log('角色扩展数据存在:', !!(character.data && character.data.extensions));

            if (character.data && character.data.extensions && character.data.extensions.vector_manager_data) {
                const vectorData = character.data.extensions.vector_manager_data;
                console.log('向量数据存在:', !!vectorData);
                console.log('保存的聊天ID:', vectorData.chatId);
                console.log('当前聊天ID:', currentChatId);
                console.log('聊天ID匹配:', vectorData.chatId === currentChatId);
                console.log('保存的向量数量:', vectorData.vectors ? vectorData.vectors.length : 0);
                console.log('向量数据时间戳:', new Date(vectorData.timestamp).toLocaleString());
            } else {
                console.log('未找到向量数据');
            }
        }

        console.log('=== 调试完成 ===');
    }

    /**
     * 调试消息结构
     */
    function debugMessageStructure() {
        console.log('=== 消息结构调试 ===');
        if (!context.chat || context.chat.length === 0) {
            console.log('没有聊天消息');
            return;
        }

        const recentMessages = context.chat.slice(-10); // 获取最近10条消息
        console.log(`分析最近 ${recentMessages.length} 条消息:`);

        recentMessages.forEach((msg, index) => {
            console.log(`消息 ${index + 1}:`, {
                name: msg.name,
                is_user: msg.is_user,
                is_system: msg.is_system,
                is_hidden: msg.is_hidden,
                send_date: msg.send_date,
                mes_preview: msg.mes ? msg.mes.substring(0, 100) + '...' : '(无内容)',
                extra: msg.extra ? Object.keys(msg.extra) : '(无extra)'
            });
        });

        // 统计消息类型
        const stats = {
            user: recentMessages.filter(msg => msg.is_user).length,
            ai: recentMessages.filter(msg => !msg.is_user && !msg.is_system).length,
            system: recentMessages.filter(msg => msg.is_system).length,
            hidden: recentMessages.filter(msg => msg.is_hidden).length
        };

        console.log('消息类型统计:', stats);
        console.log('==================');
    }

    /**
     * 深度调试AI消息筛选问题
     */
    function debugAIMessageFiltering() {
        console.log('=== AI消息筛选深度调试 ===');

        if (!context.chat || context.chat.length === 0) {
            console.log('❌ 没有聊天消息');
            return;
        }

        // 1. 分析所有消息的属性
        console.log('📊 分析所有消息属性:');
        const allMessages = context.chat;
        const messageAnalysis = allMessages.map((msg, index) => {
            const detectedType = detectMessageType(msg);
            const analysis = {
                index: index + 1,
                name: msg.name,
                is_user: msg.is_user,
                is_system: msg.is_system,
                is_hidden: msg.is_hidden,
                extra_type: msg.extra?.type,
                has_content: !!(msg.mes && msg.mes.trim()),
                content_preview: msg.mes ? msg.mes.substring(0, 50) + '...' : '(无内容)',
                detected_type: detectedType.toUpperCase()
            };
            return analysis;
        });

        // 2. 统计各类型消息数量
        const typeStats = {
            USER: messageAnalysis.filter(m => m.detected_type === 'USER').length,
            USER_ABNORMAL: messageAnalysis.filter(m => m.detected_type === 'USER_ABNORMAL').length,
            AI: messageAnalysis.filter(m => m.detected_type === 'AI').length,
            AI_ABNORMAL: messageAnalysis.filter(m => m.detected_type === 'AI_ABNORMAL').length,
            SPECIAL_SYSTEM: messageAnalysis.filter(m => m.detected_type === 'SPECIAL_SYSTEM').length,
            UNKNOWN: messageAnalysis.filter(m => m.detected_type === 'UNKNOWN').length
        };

        console.log('📈 消息类型统计:', typeStats);

        // 3. 显示最近10条消息的详细分析
        console.log('🔍 最近10条消息详细分析:');
        messageAnalysis.slice(-10).forEach(msg => {
            console.log(`消息 ${msg.index}: [${msg.detected_type}] ${msg.name} - ${msg.content_preview}`, {
                is_user: msg.is_user,
                is_system: msg.is_system,
                is_hidden: msg.is_hidden,
                extra_type: msg.extra_type
            });
        });

        // 4. 测试AI消息筛选逻辑
        console.log('🧪 测试AI消息筛选逻辑:');
        const aiMessages = allMessages.filter(msg => {
            const isAI = msg.is_user === false && msg.is_system !== true;
            const isSpecialSystemMessage = msg.extra?.type && [
                'help', 'welcome', 'empty', 'generic', 'narrator',
                'comment', 'slash_commands', 'formatting', 'hotkeys',
                'macros', 'welcome_prompt', 'assistant_note'
            ].includes(msg.extra.type);

            const shouldInclude = isAI && !isSpecialSystemMessage;

            if (isAI) {
                console.log(`AI消息检测: ${msg.name} - ${shouldInclude ? '✅ 包含' : '❌ 排除'}`, {
                    is_user: msg.is_user,
                    is_system: msg.is_system,
                    extra_type: msg.extra?.type,
                    isSpecialSystemMessage
                });
            }

            return shouldInclude;
        });

        console.log(`🎯 AI消息筛选结果: ${aiMessages.length} 条AI消息`);

        // 5. 检查UI状态
        const userCheckbox = document.getElementById('include-user');
        const aiCheckbox = document.getElementById('include-ai');
        const hiddenCheckbox = document.getElementById('include-hidden');

        console.log('🖥️ UI复选框状态:', {
            user: userCheckbox ? userCheckbox.checked : '未找到',
            ai: aiCheckbox ? aiCheckbox.checked : '未找到',
            hidden: hiddenCheckbox ? hiddenCheckbox.checked : '未找到'
        });

        // 6. 检查设置状态
        console.log('⚙️ 插件设置状态:', {
            messageTypes: settings.vectorization.messageTypes,
            layerStart: settings.vectorization.layerStart,
            layerEnd: settings.vectorization.layerEnd,
            includeChatMessages: settings.vectorization.includeChatMessages
        });

        console.log('=== AI消息筛选深度调试结束 ===');
    }

    /**
     * 获取当前角色ID（带容错处理）
     */
    function getCurrentCharacterId() {
        // 首先尝试从上下文获取
        if (context.characterId !== undefined && context.characterId !== null) {
            return context.characterId;
        }

        // 如果上下文中没有，但有角色数据，使用第一个角色
        if (context.characters && context.characters.length > 0) {
            console.log('向量插件: characterId 为空，使用第一个角色作为当前角色');
            return '0'; // 返回字符串形式的索引
        }

        return null;
    }

    /**
     * 获取存储的向量数据 - 使用项目内置API
     */
    async function getStoredVectors() {
        try {
            const collectionId = getCollectionId();

            const response = await fetch('/api/vector/list', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: collectionId,
                    source: 'webllm', // 使用webllm源
                    embeddings: {} // 空的embeddings映射
                })
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.log('向量插件: 集合不存在，返回空数组');
                    return [];
                }
                const errorText = await response.text();
                throw new Error(`获取向量列表API错误 ${response.status}: ${errorText}`);
            }

            const hashes = await response.json();
            console.log(`向量插件: 从API获取了 ${hashes.length} 个向量哈希`);
            return hashes;
        } catch (error) {
            console.error('向量插件: 从API获取向量失败', error);
            return [];
        }
    }

    /**
     * 清空向量存储 - 使用项目内置API
     */
    async function clearVectorStorage() {
        try {
            const collectionId = getCollectionId();

            const response = await fetch('/api/vector/purge', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: collectionId
                })
            });

            if (response.ok) {
                showNotification('向量存储已清空', 'info');
                console.log('向量插件: 向量存储已清空');
            } else {
                const errorText = await response.text();
                throw new Error(`清空向量API错误 ${response.status}: ${errorText}`);
            }
        } catch (error) {
            console.error('向量插件: 清空向量存储失败', error);
            showNotification(`清空向量存储失败: ${error.message}`, 'error');
        }
    }

    /**
     * 获取当前聊天ID
     */
    function getCurrentChatId() {
        // 直接使用context提供的getCurrentChatId函数或chatId属性
        if (typeof context.getCurrentChatId === 'function') {
            return context.getCurrentChatId();
        } else if (context.chatId) {
            return context.chatId;
        }

        // 备用方案：手动计算
        if (context.groupId) {
            const group = context.groups?.find(x => x.id == context.groupId);
            return group?.chat_id;
        } else if (context.characterId !== undefined && context.characters[context.characterId]) {
            return context.characters[context.characterId].chat;
        }
        return null;
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
        return Math.abs(hash);
    }

    /**
     * 插入向量 - 混合模式：外部API获取embeddings + 内置API存储
     */
    async function insertVectors(chunks) {
        try {
            if (!chunks || chunks.length === 0) {
                throw new Error('没有要插入的向量数据');
            }

            if (!settings.vectorQuery.apiKey) {
                throw new Error('请先配置向量查询API Key');
            }

            console.log('向量插件: 开始混合模式向量插入');
            console.log('待处理文本块数量:', chunks.length);

            // 1. 使用外部API批量获取向量嵌入
            console.log('步骤1: 使用外部API批量获取embeddings');
            const texts = chunks.map(chunk => chunk.text);
            const embeddings = await batchGetEmbeddings(
                texts,
                settings.vectorQuery.apiKey,
                settings.vectorQuery.model,
                settings.vectorQuery.batchSize
            );
            console.log('embeddings获取成功，数量:', embeddings.length);

            // 2. 准备向量数据项（包含embedding）
            const items = chunks.map((chunk, index) => ({
                hash: generateHash(chunk.text + Date.now() + index),
                text: chunk.text,
                embedding: embeddings[index], // 包含外部API获取的embedding
                index: chunk.index || index,
                timestamp: chunk.timestamp || Date.now(),
                ...chunk.metadata
            }));

            // 3. 使用内置API存储向量
            console.log('步骤2: 使用内置API存储向量');
            const collectionId = getCollectionId();

            // 准备embeddings映射，用于webllm源
            const embeddingsMap = {};
            items.forEach(item => {
                embeddingsMap[item.text] = item.embedding;
            });

            const response = await fetch('/api/vector/insert', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: collectionId,
                    items: items.map(item => ({
                        hash: item.hash,
                        text: item.text,
                        index: item.index
                    })),
                    source: 'webllm', // 使用webllm源，支持预计算的embeddings
                    embeddings: embeddingsMap // 直接传递embeddings映射
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`向量插入API错误 ${response.status}: ${errorText}`);
            }

            console.log(`向量插件: 成功插入 ${items.length} 个向量到集合 ${collectionId}`);
            showNotification(`成功向量化 ${items.length} 个文本块`, 'success');
            return { success: true, count: items.length };
        } catch (error) {
            console.error('向量插入失败:', error);
            showNotification(`向量插入失败: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * 删除向量 - 使用项目内置API
     */
    async function deleteVectors(hashes) {
        try {
            if (!hashes || hashes.length === 0) {
                throw new Error('没有要删除的向量哈希');
            }

            const collectionId = getCollectionId();

            const response = await fetch('/api/vector/delete', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: collectionId,
                    hashes: hashes,
                    source: 'webllm', // 使用webllm源
                    embeddings: {} // 空的embeddings映射
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`删除向量API错误 ${response.status}: ${errorText}`);
            }

            console.log(`向量插件: 成功删除 ${hashes.length} 个向量`);
            return { success: true, count: hashes.length };
        } catch (error) {
            console.error('删除向量失败:', error);
            showNotification(`删除向量失败: ${error.message}`, 'error');
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

            showNotification('正在测试混合向量API...', 'info');

            const testText = "这是一个测试文本";

            // 1. 测试外部API连接
            console.log('测试步骤1: 外部API连接测试');
            const embedding = await getTextEmbedding(
                testText,
                settings.vectorQuery.apiKey,
                settings.vectorQuery.model
            );

            if (embedding && embedding.length > 0) {
                console.log(`外部API连接成功！向量维度: ${embedding.length}`);

                // 2. 测试完整的插入和查询流程
                console.log('测试步骤2: 完整流程测试');
                const testChunks = [{
                    text: testText,
                    index: 0,
                    timestamp: Date.now()
                }];

                // 测试插入向量
                const insertResult = await insertVectors(testChunks);

                if (insertResult.success) {
                    // 测试查询向量
                    const queryResults = await queryVectors(testText, 1);

                    if (queryResults.length > 0) {
                        showNotification(`混合向量API测试成功！外部API: ${settings.vectorQuery.apiEndpoint}, 向量维度: ${embedding.length}`, 'success');

                        // 清理测试数据
                        try {
                            await deleteVectors([queryResults[0].hash]);
                            console.log('向量插件: 测试数据已清理');
                        } catch (cleanupError) {
                            console.warn('向量插件: 清理测试数据失败', cleanupError);
                        }
                    } else {
                        showNotification('向量查询测试失败：未找到插入的测试数据', 'error');
                    }
                } else {
                    showNotification('向量插入测试失败', 'error');
                }
            } else {
                showNotification('外部API连接失败：返回的向量为空', 'error');
            }
        } catch (error) {
            console.error('向量API测试失败:', error);
            showNotification(`向量API测试失败: ${error.message}`, 'error');
        }
    }

    /**
     * 显示向量统计信息
     */
    async function showVectorStats() {
        try {
            const vectors = await getStoredVectors();
            const totalVectors = vectors.length;

            if (totalVectors === 0) {
                showNotification('暂无向量数据', 'info');
                return;
            }

            const collectionId = getCollectionId();

            const statsText = `
向量统计信息:
- 集合ID: ${collectionId}
- 向量源: 混合模式 (外部API + 内置存储)
- 总向量数: ${totalVectors}
- 向量哈希示例: ${vectors.slice(0, 3).join(', ')}${vectors.length > 3 ? '...' : ''}
            `.trim();

            // 显示统计信息模态框
            showPreviewModal(statsText);
        } catch (error) {
            console.error('获取向量统计失败:', error);
            showNotification(`获取向量统计失败: ${error.message}`, 'error');
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
                                <small>混合模式：外部API获取embeddings + 内置向量数据库存储</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label" for="query-api-endpoint">API 端点:</label>
                                <select id="query-api-endpoint" class="vector-form-select">
                                    <option value="openai">OpenAI (推荐)</option>
                                    <option value="azure">Azure OpenAI</option>
                                    <option value="custom">自定义端点</option>
                                </select>
                                <small>选择外部向量化服务提供商</small>
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
                                        🔗 测试混合API
                                    </button>
                                    <button class="vector-btn" onclick="showVectorStats()">
                                        📊 查看向量统计
                                    </button>
                                    <button class="vector-btn" onclick="clearVectorStorage()"
                                            style="background-color: #dc3545; color: white; border-color: #dc3545;">
                                        🗑️ 清空存储
                                    </button>
                                </div>
                                <small>混合模式：外部API获取高质量embeddings + 内置向量数据库管理</small>
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
                                <label class="vector-form-label">聊天层数范围:</label>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <div style="flex: 1;">
                                        <label for="layer-start" style="font-size: 12px; color: #666;">开始楼层:</label>
                                        <input type="number" id="layer-start" class="vector-form-input" min="1" value="1" style="margin-top: 2px;">
                                    </div>
                                    <span style="margin: 20px 5px 0 5px;">-</span>
                                    <div style="flex: 1;">
                                        <label for="layer-end" style="font-size: 12px; color: #666;">结束楼层:</label>
                                        <input type="number" id="layer-end" class="vector-form-input" min="1" value="10" style="margin-top: 2px;">
                                    </div>
                                </div>
                                <small>楼层从1开始计数，1表示第1条消息（最早），数字越大表示越新的消息。例如：1-180表示从第1条到第180条消息</small>
                            </div>

                            <div class="vector-form-group">
                                <label class="vector-form-label">消息类型:</label>
                                <div style="display: flex; flex-direction: column; gap: 8px;">
                                    <label class="vector-form-label"><input type="checkbox" id="include-user"> 用户消息</label>
                                    <label class="vector-form-label"><input type="checkbox" id="include-ai"> AI消息</label>
                                    <label class="vector-form-label"><input type="checkbox" id="include-hidden"> 隐藏消息</label>
                                </div>
                                <small>向量数据将自动保存到 SillyTavern 数据库中，与当前角色和聊天绑定</small>
                            </div>

                            <div class="vector-form-group">
                                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                                    <button class="vector-btn vector-btn-success" onclick="startVectorization()">
                                        🚀 开始向量化
                                    </button>
                                    <button class="vector-btn" onclick="showPreview()">
                                        👁️ 预览内容
                                    </button>
                                    <button class="vector-btn" onclick="debugContextState()" style="background-color: #6c757d;">
                                        🔍 调试上下文
                                    </button>
                                    <button class="vector-btn" onclick="debugMessageStructure()" style="background-color: #17a2b8;">
                                        📋 消息结构
                                    </button>
                                    <button class="vector-btn" onclick="debugAIMessageFiltering()" style="background-color: #28a745;">
                                        🤖 AI消息调试
                                    </button>
                                    <button class="vector-btn" onclick="debugDetailedIssues()" style="background-color: #dc3545;">
                                        🐛 详细调试
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

        // 层数范围实时保存事件
        const layerStartInput = document.getElementById('layer-start');
        const layerEndInput = document.getElementById('layer-end');

        if (layerStartInput) {
            layerStartInput.addEventListener('input', () => {
                const value = parseInt(layerStartInput.value);
                if (!isNaN(value) && value >= 1) {
                    settings.vectorization.layerStart = value;
                    saveSettings();
                    console.log('向量插件: 开始楼层自动保存:', value);
                }
            });
        }

        if (layerEndInput) {
            layerEndInput.addEventListener('input', () => {
                const value = parseInt(layerEndInput.value);
                if (!isNaN(value) && value >= 1) {
                    settings.vectorization.layerEnd = value;
                    saveSettings();
                    console.log('向量插件: 结束楼层自动保存:', value);
                }
            });
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

        // 兼容旧版本的 layerRange 格式
        if (s.vectorization.layerRange && typeof s.vectorization.layerRange === 'string') {
            try {
                const { start, end } = parseLayerRangeOld(s.vectorization.layerRange);
                s.vectorization.layerStart = start;
                s.vectorization.layerEnd = end;
            } catch (error) {
                console.warn('解析旧版本层数范围失败，使用默认值', error);
                s.vectorization.layerStart = 1;
                s.vectorization.layerEnd = 10;
            }
        }

        document.getElementById('layer-start').value = s.vectorization.layerStart || 1;
        document.getElementById('layer-end').value = s.vectorization.layerEnd || 10;
        document.getElementById('include-user').checked = s.vectorization.messageTypes.user;
        document.getElementById('include-ai').checked = s.vectorization.messageTypes.ai;
        document.getElementById('include-hidden').checked = s.vectorization.messageTypes.hidden;
    }

    /**
     * 从表单保存设置
     */
    function saveSettingsFromForm() {
        try {
            // 向量查询设置
            settings.vectorQuery.enabled = document.getElementById('query-enabled').checked;
            settings.vectorQuery.apiEndpoint = document.getElementById('query-api-endpoint').value;
            settings.vectorQuery.customApiUrl = document.getElementById('custom-api-url').value;
            settings.vectorQuery.apiKey = document.getElementById('query-api-key').value;
            settings.vectorQuery.model = document.getElementById('query-model').value;
            settings.vectorQuery.notifySuccess = document.getElementById('query-notify').checked;

            // 数值参数验证和修正
            let chunkSize = parseInt(document.getElementById('chunk-size').value);
            let overlap = parseInt(document.getElementById('overlap-size').value);

            // 验证 chunkSize
            if (isNaN(chunkSize) || chunkSize <= 0) {
                chunkSize = 512;
                document.getElementById('chunk-size').value = chunkSize;
                showNotification('块大小无效，已重置为 512', 'warning');
            } else if (chunkSize > 8192) {
                chunkSize = 8192;
                document.getElementById('chunk-size').value = chunkSize;
                showNotification('块大小过大，已限制为 8192', 'warning');
            }

            // 验证 overlap
            if (isNaN(overlap) || overlap < 0) {
                overlap = 0;
                document.getElementById('overlap-size').value = overlap;
                showNotification('重叠大小无效，已重置为 0', 'warning');
            } else if (overlap >= chunkSize) {
                overlap = Math.floor(chunkSize * 0.5);
                document.getElementById('overlap-size').value = overlap;
                showNotification(`重叠大小不能大于等于块大小，已调整为 ${overlap}`, 'warning');
            }

            settings.vectorQuery.chunkSize = chunkSize;
            settings.vectorQuery.overlap = overlap;

            // 其他数值参数验证
            let scoreThreshold = parseFloat(document.getElementById('score-threshold').value);
            if (isNaN(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 1) {
                scoreThreshold = 0.7;
                document.getElementById('score-threshold').value = scoreThreshold;
                showNotification('分数阈值无效，已重置为 0.7', 'warning');
            }
            settings.vectorQuery.scoreThreshold = scoreThreshold;

            let queryMessageCount = parseInt(document.getElementById('query-message-count').value);
            if (isNaN(queryMessageCount) || queryMessageCount <= 0) {
                queryMessageCount = 5;
                document.getElementById('query-message-count').value = queryMessageCount;
                showNotification('查询消息数量无效，已重置为 5', 'warning');
            }
            settings.vectorQuery.queryMessageCount = queryMessageCount;

            let maxResults = parseInt(document.getElementById('max-results').value);
            if (isNaN(maxResults) || maxResults <= 0) {
                maxResults = 10;
                document.getElementById('max-results').value = maxResults;
                showNotification('最大结果数量无效，已重置为 10', 'warning');
            }
            settings.vectorQuery.maxResults = maxResults;

            let batchSize = parseInt(document.getElementById('batch-size').value);
            if (isNaN(batchSize) || batchSize <= 0) {
                batchSize = 5;
                document.getElementById('batch-size').value = batchSize;
                showNotification('批处理大小无效，已重置为 5', 'warning');
            }
            settings.vectorQuery.batchSize = batchSize;

            // Rerank设置
            settings.rerank.enabled = document.getElementById('rerank-enabled').checked;
            settings.rerank.notify = document.getElementById('rerank-notify').checked;
            settings.rerank.apiKey = document.getElementById('rerank-api-key').value;
            settings.rerank.model = document.getElementById('rerank-model').value;

            let rerankTopN = parseInt(document.getElementById('rerank-top-n').value);
            if (isNaN(rerankTopN) || rerankTopN <= 0) {
                rerankTopN = 5;
                document.getElementById('rerank-top-n').value = rerankTopN;
                showNotification('Rerank Top N 无效，已重置为 5', 'warning');
            }
            settings.rerank.topN = rerankTopN;

            let hybridWeight = parseFloat(document.getElementById('hybrid-weight').value);
            if (isNaN(hybridWeight) || hybridWeight < 0 || hybridWeight > 1) {
                hybridWeight = 0.5;
                document.getElementById('hybrid-weight').value = hybridWeight;
                showNotification('混合权重无效，已重置为 0.5', 'warning');
            }
            settings.rerank.hybridWeight = hybridWeight;

            // 注入设置
            settings.injection.template = document.getElementById('injection-template').value;

            let injectionDepth = parseInt(document.getElementById('injection-depth').value);
            if (isNaN(injectionDepth) || injectionDepth < 0) {
                injectionDepth = 1;
                document.getElementById('injection-depth').value = injectionDepth;
                showNotification('注入深度无效，已重置为 1', 'warning');
            }
            settings.injection.depth = injectionDepth;
            settings.injection.roleType = document.getElementById('role-type').value;

            // 向量化设置
            settings.vectorization.includeChatMessages = document.getElementById('include-chat-messages').checked;

            // 验证层数范围
            let layerStart = parseInt(document.getElementById('layer-start').value);
            let layerEnd = parseInt(document.getElementById('layer-end').value);

            // 验证开始楼层
            if (isNaN(layerStart) || layerStart < 1) {
                layerStart = 1;
                document.getElementById('layer-start').value = layerStart;
                showNotification('开始楼层无效，已重置为 1', 'warning');
            }

            // 验证结束楼层
            if (isNaN(layerEnd) || layerEnd < 1) {
                layerEnd = 10;
                document.getElementById('layer-end').value = layerEnd;
                showNotification('结束楼层无效，已重置为 10', 'warning');
            }

            // 确保开始楼层不大于结束楼层
            if (layerStart > layerEnd) {
                const temp = layerStart;
                layerStart = layerEnd;
                layerEnd = temp;
                document.getElementById('layer-start').value = layerStart;
                document.getElementById('layer-end').value = layerEnd;
                showNotification('开始楼层不能大于结束楼层，已自动调整', 'warning');
            }

            settings.vectorization.layerStart = layerStart;
            settings.vectorization.layerEnd = layerEnd;

            settings.vectorization.messageTypes.user = document.getElementById('include-user').checked;
            settings.vectorization.messageTypes.ai = document.getElementById('include-ai').checked;
            settings.vectorization.messageTypes.hidden = document.getElementById('include-hidden').checked;

            saveSettings();
            showNotification('设置已保存', 'success');

        } catch (error) {
            console.error('保存设置时出错:', error);
            showNotification(`保存设置失败: ${error.message}`, 'error');
        }
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
     * 解析旧版本的层数范围格式（兼容性函数）
     */
    function parseLayerRangeOld(rangeString) {
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
     * 获取指定范围的聊天消息
     */
    function getMessagesByRange(startLayer, endLayer) {
        if (!context.chat || context.chat.length === 0) {
            return [];
        }

        const totalMessages = context.chat.length;

        // 层数从1开始，1表示第1条消息（最早的消息）
        // 用户输入1-180表示要第1条到第180条消息
        const startIndex = Math.max(0, startLayer - 1); // 转换为0基索引
        const endIndex = Math.min(totalMessages, endLayer); // endLayer本身就是要包含的最后一条

        if (startIndex >= endIndex) {
            return [];
        }

        console.log(`向量插件: 获取消息范围 ${startLayer}-${endLayer}，总消息数: ${totalMessages}，实际索引: ${startIndex}-${endIndex}`);

        return context.chat.slice(startIndex, endIndex);
    }



    /**
     * 开始向量化
     */
    async function startVectorization() {
        try {
            // 调试当前上下文状态
            debugContextState();

            // 检查是否选择了角色
            const currentCharId = getCurrentCharacterId();
            if (!currentCharId) {
                showNotification('请先选择一个角色，向量数据需要与角色绑定', 'warning');
                console.log('向量插件: 角色检查失败，characterId:', currentCharId);
                return;
            }

            console.log('向量插件: 使用角色ID:', currentCharId);

            // 检查是否有聊天记录
            if (!context.chat || context.chat.length === 0) {
                showNotification('当前没有聊天记录可以向量化', 'warning');
                return;
            }

            if (!settings.vectorization.includeChatMessages) {
                showNotification('请先勾选聊天消息', 'warning');
                return;
            }

            // 获取指定范围的消息
            const messages = getMessagesByRange(settings.vectorization.layerStart, settings.vectorization.layerEnd);

            if (messages.length === 0) {
                showNotification(`没有找到楼层 ${settings.vectorization.layerStart}-${settings.vectorization.layerEnd} 的聊天消息`, 'warning');
                return;
            }

            console.log(`向量插件: 获取到 ${messages.length} 条消息，楼层范围: ${settings.vectorization.layerStart}-${settings.vectorization.layerEnd}`);

            // 按类型筛选
            const typeFiltered = filterMessagesByType(messages, settings.vectorization.messageTypes);
            console.log(`向量插件: 类型筛选后剩余 ${typeFiltered.length} 条消息`);

            if (typeFiltered.length === 0) {
                showNotification('根据筛选条件没有找到消息', 'warning');
                return;
            }

            // 提取文本内容
            const textContent = extractTextContent(typeFiltered);
            console.log(`向量插件: 提取文本内容后剩余 ${textContent.length} 条有效消息`);

            // 分块处理
            const allChunks = [];
            const maxChunksPerMessage = 1000; // 每条消息最大块数限制
            const maxTotalChunks = 10000; // 总块数限制

            for (let index = 0; index < textContent.length; index++) {
                const item = textContent[index];

                // 验证文本内容
                if (!item.text || typeof item.text !== 'string') {
                    console.warn(`跳过无效的消息内容，索引: ${index}`);
                    continue;
                }

                try {
                    const chunks = splitIntoChunks(item.text, settings.vectorQuery.chunkSize, settings.vectorQuery.overlap);

                    // 检查单条消息的块数限制
                    if (chunks.length > maxChunksPerMessage) {
                        console.warn(`消息 ${index} 生成了过多的块 (${chunks.length})，截取前 ${maxChunksPerMessage} 个`);
                        chunks.splice(maxChunksPerMessage);
                    }

                    // 处理每个块
                    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                        const chunk = chunks[chunkIndex];

                        // 检查总块数限制
                        if (allChunks.length >= maxTotalChunks) {
                            console.warn(`达到最大块数限制 (${maxTotalChunks})，停止处理`);
                            break;
                        }

                        allChunks.push({
                            text: chunk.text,
                            hash: generateHash(chunk.text),
                            source: `message_${index}_chunk_${chunkIndex}`,
                            timestamp: item.timestamp,
                            isUser: item.isUser,
                            name: item.name
                        });
                    }

                    // 如果达到总限制，退出外层循环
                    if (allChunks.length >= maxTotalChunks) {
                        break;
                    }

                } catch (error) {
                    console.error(`处理消息 ${index} 时出错:`, error);
                    showNotification(`处理消息 ${index} 时出错: ${error.message}`, 'warning');
                    continue;
                }
            }

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

            // 自动保存设置，避免用户需要手动点击保存
            saveSettings();
            console.log('向量插件: 向量化完成后自动保存设置');

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
     * 测试 splitIntoChunks 函数
     */
    function testSplitIntoChunks() {
        console.log('=== 测试 splitIntoChunks 函数 ===');

        // 测试用例1：正常情况
        const result1 = splitIntoChunks('这是一个测试文本，用来验证分块功能是否正常工作。', 10, 2);
        console.log('测试1 - 正常分块:', result1);

        // 测试用例2：overlap >= chunkSize（之前会导致无限循环的情况）
        const result2 = splitIntoChunks('这是一个测试文本', 5, 5);
        console.log('测试2 - overlap等于chunkSize:', result2);

        // 测试用例3：overlap > chunkSize
        const result3 = splitIntoChunks('这是一个测试文本', 5, 10);
        console.log('测试3 - overlap大于chunkSize:', result3);

        // 测试用例4：空文本
        const result4 = splitIntoChunks('', 10, 2);
        console.log('测试4 - 空文本:', result4);

        // 测试用例5：无效参数
        const result5 = splitIntoChunks('测试', 0, 2);
        console.log('测试5 - 无效chunkSize:', result5);

        console.log('=== 测试完成 ===');
    }

    // 在开发模式下运行测试
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        // 延迟执行测试，确保函数已定义
        setTimeout(testSplitIntoChunks, 1000);
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
            console.log('=== 向量插件预览调试开始 ===');

            // 1. 检查基本设置
            console.log('当前设置:', settings);
            console.log('includeChatMessages:', settings.vectorization.includeChatMessages);
            console.log('messageTypes:', settings.vectorization.messageTypes);

            // 2. 检查UI状态
            const userChecked = document.getElementById('include-user')?.checked;
            const aiChecked = document.getElementById('include-ai')?.checked;
            const hiddenChecked = document.getElementById('include-hidden')?.checked;
            console.log('UI复选框状态:', { userChecked, aiChecked, hiddenChecked });

            // 3. 强制从UI读取当前状态
            const currentTypes = {
                user: userChecked === true,
                ai: aiChecked === true,
                hidden: hiddenChecked === true
            };
            console.log('当前筛选类型:', currentTypes);

            // 4. 如果没有选择任何类型，给出警告
            if (!currentTypes.user && !currentTypes.ai && !currentTypes.hidden) {
                showNotification('请至少选择一种消息类型', 'warning');
                console.log('=== 预览调试结束：未选择消息类型 ===');
                return;
            }

            if (!settings.vectorization.includeChatMessages) {
                showNotification('请先勾选聊天消息', 'warning');
                return;
            }

            // 获取指定范围的消息
            const messages = getMessagesByRange(settings.vectorization.layerStart, settings.vectorization.layerEnd);

            if (messages.length === 0) {
                showNotification(`没有找到楼层 ${settings.vectorization.layerStart}-${settings.vectorization.layerEnd} 的聊天消息`, 'warning');
                return;
            }

            console.log(`向量插件: 获取到 ${messages.length} 条消息，楼层范围: ${settings.vectorization.layerStart}-${settings.vectorization.layerEnd}`);

            // 使用当前UI状态进行筛选，而不是保存的设置
            const typeFiltered = filterMessagesByType(messages, currentTypes);

            if (typeFiltered.length === 0) {
                showNotification('根据筛选条件没有找到消息', 'warning');
                console.log('=== 预览调试结束：无匹配消息 ===');
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

            console.log('=== 向量插件预览调试结束 ===');

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

        // 注册事件监听器
        registerEventListeners();

        console.log('向量管理插件已初始化');
    }

    /**
     * 注册事件监听器
     */
    function registerEventListeners() {
        if (!context || !context.eventSource) {
            console.error('向量插件: 无法获取事件源');
            return;
        }

        // 监听生成开始前事件，进行向量查询和注入
        context.eventSource.on(context.eventTypes.GENERATION_AFTER_COMMANDS, handleGenerationAfterCommands);

        // 监听聊天变化事件
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, handleChatChanged);

        console.log('向量插件: 事件监听器已注册');
    }

    /**
     * 处理生成开始前的向量查询和注入
     */
    async function handleGenerationAfterCommands(type, params, dryRun) {
        try {
            // 如果是干运行或者向量查询未启用，跳过
            if (dryRun || !settings.vectorQuery.enabled) {
                return;
            }

            // 跳过某些特殊类型的生成
            if (['quiet', 'impersonate'].includes(type)) {
                return;
            }

            console.log('向量插件: 开始向量查询流程', { type, params });

            // 执行向量查询和注入
            await performVectorQueryAndInjection();

        } catch (error) {
            console.error('向量插件: 生成前处理失败', error);
            if (settings.vectorQuery.notifySuccess) {
                showNotification(`向量查询失败: ${error.message}`, 'error');
            }
        }
    }

    /**
     * 处理聊天变化事件
     */
    function handleChatChanged(chatId) {
        console.log('向量插件: 聊天已切换', chatId);
        // 可以在这里做一些聊天切换后的初始化工作
    }

    /**
     * 执行向量查询和注入的完整流程
     */
    async function performVectorQueryAndInjection() {
        try {
            // 1. 获取最近的聊天消息作为查询文本
            const queryMessages = getRecentMessages(settings.vectorQuery.queryMessageCount);
            if (queryMessages.length === 0) {
                console.log('向量插件: 没有可用的查询消息');
                return;
            }

            // 2. 提取查询文本
            const queryTextContent = extractTextContent(queryMessages);
            const queryText = queryTextContent.map(item => item.text).join(' ');

            if (!queryText.trim()) {
                console.log('向量插件: 查询文本为空');
                return;
            }

            console.log('向量插件: 查询文本', queryText.substring(0, 200) + '...');

            // 3. 执行向量查询
            const vectorResults = await queryVectors(queryText);

            if (!vectorResults || vectorResults.length === 0) {
                console.log('向量插件: 没有找到相关的向量结果');
                if (settings.vectorQuery.notifySuccess) {
                    showNotification('向量查询完成，但没有找到相关内容', 'info');
                }
                return;
            }

            console.log(`向量插件: 找到 ${vectorResults.length} 个向量结果`);

            // 4. 应用分数阈值筛选
            const filteredResults = vectorResults.filter(result =>
                result.score >= settings.vectorQuery.scoreThreshold
            );

            if (filteredResults.length === 0) {
                console.log('向量插件: 所有结果都低于分数阈值');
                if (settings.vectorQuery.notifySuccess) {
                    showNotification('向量查询完成，但所有结果都低于分数阈值', 'info');
                }
                return;
            }

            // 5. 限制结果数量
            const limitedResults = filteredResults.slice(0, settings.vectorQuery.maxResults);

            // 6. Rerank 处理（如果启用）
            let finalResults = limitedResults;
            if (settings.rerank.enabled && settings.rerank.apiKey) {
                try {
                    finalResults = await processRerank(queryText, limitedResults);
                    console.log(`向量插件: Rerank 处理完成，最终结果数量: ${finalResults.length}`);
                } catch (error) {
                    console.warn('向量插件: Rerank 处理失败，使用原始结果', error);
                    if (settings.rerank.notify) {
                        showNotification(`Rerank 处理失败: ${error.message}`, 'warning');
                    }
                }
            }

            // 7. 注入到聊天上下文
            await injectVectorResults(finalResults);

            // 8. 成功通知
            if (settings.vectorQuery.notifySuccess) {
                showNotification(`向量查询成功，注入了 ${finalResults.length} 个相关内容`, 'success');
            }

        } catch (error) {
            console.error('向量插件: 向量查询和注入流程失败', error);
            throw error;
        }
    }





    /**
     * 将向量查询结果注入到聊天上下文
     */
    async function injectVectorResults(results) {
        try {
            if (!results || results.length === 0) {
                return;
            }

            // 1. 格式化注入内容
            const injectionContent = formatInjectionContent(results);

            if (!injectionContent.trim()) {
                console.log('向量插件: 注入内容为空');
                return;
            }

            // 2. 使用 SillyTavern 的扩展提示系统进行注入
            if (typeof context.setExtensionPrompt === 'function') {
                // 使用官方扩展提示系统
                // setExtensionPrompt(key, value, position, depth, scan, role, filter)
                const position = context.extension_prompt_types ? context.extension_prompt_types.IN_PROMPT : 0;
                const role = getRoleFromSettings();

                context.setExtensionPrompt(
                    'VECTOR_MANAGER',
                    injectionContent,
                    position,
                    settings.injection.depth,
                    false, // scan
                    role,
                    null // filter
                );
                console.log('向量插件: 使用扩展提示系统注入内容');
            } else {
                // 备用方案：直接注入到聊天历史
                await injectToChat(injectionContent);
                console.log('向量插件: 使用备用方案注入内容');
            }

        } catch (error) {
            console.error('向量插件: 注入失败', error);
            throw error;
        }
    }

    /**
     * 格式化注入内容
     */
    function formatInjectionContent(results) {
        const formattedResults = results.map((result, index) => {
            const scorePercent = Math.round(result.score * 100);
            const timeStr = result.timestamp ? new Date(result.timestamp).toLocaleString() : '未知时间';
            const speaker = result.name || (result.isUser ? 'User' : 'Assistant');

            return `[${index + 1}] (相似度: ${scorePercent}%, 来源: ${speaker}, 时间: ${timeStr})\n${result.text}`;
        }).join('\n\n');

        // 应用用户自定义的注入模板
        const template = settings.injection.template || '相关内容：\n{{text}}';
        return template.replace('{{text}}', formattedResults);
    }

    /**
     * 备用注入方案：直接注入到聊天历史
     */
    async function injectToChat(content) {
        try {
            const chat = context.chat;
            if (!chat || !Array.isArray(chat)) {
                throw new Error('无法获取聊天历史');
            }

            // 计算注入位置
            const injectionIndex = Math.max(0, chat.length - settings.injection.depth);

            // 创建注入消息
            const injectionMessage = {
                name: getInjectionRoleName(),
                is_user: settings.injection.roleType === 'user',
                is_system: settings.injection.roleType === 'system',
                send_date: Date.now(),
                mes: content,
                extra: {
                    isVectorInjection: true,
                    vectorManagerPlugin: true
                }
            };

            // 插入到指定位置
            chat.splice(injectionIndex, 0, injectionMessage);

            // 保存聊天记录
            if (typeof context.saveChatDebounced === 'function') {
                context.saveChatDebounced();
            }

            console.log(`向量插件: 内容已注入到位置 ${injectionIndex}`);

        } catch (error) {
            console.error('向量插件: 备用注入方案失败', error);
            throw error;
        }
    }

    /**
     * 获取注入角色名称
     */
    function getInjectionRoleName() {
        switch (settings.injection.roleType) {
            case 'system':
                return 'System';
            case 'user':
                return context.name1 || 'User';
            case 'character':
                return context.name2 || 'Assistant';
            default:
                return 'Vector Manager';
        }
    }

    /**
     * 根据设置获取扩展提示角色
     */
    function getRoleFromSettings() {
        if (!context.extension_prompt_roles) {
            return 0; // 默认为 SYSTEM
        }

        switch (settings.injection.roleType) {
            case 'system':
                return context.extension_prompt_roles.SYSTEM;
            case 'user':
                return context.extension_prompt_roles.USER;
            case 'character':
            case 'assistant':
                return context.extension_prompt_roles.ASSISTANT;
            default:
                return context.extension_prompt_roles.SYSTEM;
        }
    }

    // 全局函数，供HTML调用
    window.closeVectorModal = closeModal;
    window.saveVectorSettings = () => {
        saveSettingsFromForm();
        saveSettings();
        showNotification('设置已保存', 'success');
    };
    window.resetVectorSettings = () => {
        if (confirm('确定要重置所有设置吗？')) {
            context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
            settings = getSettings();
            loadSettingsToForm();
            saveSettings();
            showNotification('设置已重置', 'info');
        }
    };
    window.startVectorization = startVectorization;
    window.showPreview = showPreview;
    window.closePreviewModal = closePreviewModal;
    window.testVectorAPI = testVectorAPI;
    window.showVectorStats = showVectorStats;
    window.clearVectorStorage = clearVectorStorage;
    window.debugContextState = debugContextState;
    window.debugDetailedIssues = debugDetailedIssues;
    window.debugMessageStructure = debugMessageStructure;
    window.debugAIMessageFiltering = debugAIMessageFiltering;

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
