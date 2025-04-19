document.addEventListener('DOMContentLoaded', () => {
    // --- Helper: Typewriter effect for text elements ---
    function typeOut(element, text, delay = 50, callback) {
        element.textContent = "";
        let index = 0;
        const interval = setInterval(() => {
            element.textContent += text.charAt(index);
            index++;
            if (index >= text.length) {
                clearInterval(interval);
                if (callback) callback();
            }
        }, delay);
    }
    
    // --- Theme Selection Setup ---
    const themeSelect = document.getElementById('theme-select');
    const savedTheme = localStorage.getItem('theme') || "dark";
    themeSelect.value = savedTheme;
    document.getElementById('theme-style').href = `/static/themes/${savedTheme}.css`;
    themeSelect.addEventListener('change', () => {
        const selectedTheme = themeSelect.value;
        document.getElementById('theme-style').href = `/static/themes/${selectedTheme}.css`;
        localStorage.setItem('theme', selectedTheme);
    });
    
    // --- DOM Elements ---
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const cancelBtn = document.getElementById('cancel-btn'); // Cancel button in HTML
    const promptGalleryBtn = document.getElementById('prompt-gallery-btn');
    const promptGalleryModal = document.getElementById('prompt-gallery-modal');
    const settingsBtnHeader = document.getElementById('settings-btn-header');
    const settingsBtnGlobal = document.getElementById('settings-btn-global');
    const settingsModal = document.getElementById('settings-modal');
    const modelSelect = document.getElementById('model-select');
    const systemInstructionTextarea = document.getElementById('system-instruction');
    const clearChatBtn = document.getElementById('clear-chats-btn');
    const newChatBtn = document.querySelector('.new-chat-btn');
    const conversationModeSelector = document.getElementById('conversation-mode');
    const chatTitle = document.getElementById('chat-title');
    const currentModelDisplay = document.getElementById('current-model');
    
    // --- State Variables ---
    let chatHistory = [];
    let currentAIResponseElement = null;
    let currentAIMessageContainer = null;
    let eventSource = null;
    let controller = null;
    let activeSession = true;
    let currentChatName = "";
    
    // --- Config (Defaults from Flask/HTML) ---
    const defaultConfig = window.appConfig || {
         defaultModel: "gemini-1.0-pro-001",
         defaultSystemInstruction: "Your name is Zoro. You are a helpful and friendly AI assistant."
    };

    // --- Update Current Model Display using Friendly Option Text ---
    function updateCurrentModelDisplay() {
        let selectedText = modelSelect.options[modelSelect.selectedIndex].text;
        currentModelDisplay.textContent = "Model: " + selectedText;
    }
    updateCurrentModelDisplay();
    modelSelect.addEventListener('change', () => {
         updateCurrentModelDisplay();
         saveSettings();
    });

    // --- "Fence Aware" Markdown Rendering ---
    function parseWithFences(text) {
        const lines = text.split('\n');
        let inFence = false;
        let processedLines = [];
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.trim().startsWith('```')) {
                inFence = !inFence;
            }
            processedLines.push(line);
        }
        if (inFence) {
            processedLines.push('```');
        }
        return processedLines.join('\n');
    }

    function renderMarkdown(text) {
        if (!text) return '';
        if (text.startsWith('[')) {
            return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
        try {
            const finalizedText = parseWithFences(text.trim());
            return marked.parse(finalizedText);
        } catch (e) {
            console.error("Markdown parsing failed:", e);
            return text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '<br>');
        }
    }

    // --- Chat Naming Functions ---
    async function getChatName(history) {
        try {
            const response = await fetch('/name_chat', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_history: history })
            });
            if (!response.ok) throw new Error("Naming endpoint returned an error");
            const data = await response.json();
            if (data.chat_title && data.chat_title.trim().length > 0) {
                return data.chat_title.trim();
            }
            throw new Error("Empty chat title received");
        } catch (e) {
            console.error("Error generating chat name:", e);
            let chatCounter = parseInt(localStorage.getItem('fallbackChatCounter') || "0", 10);
            chatCounter++;
            localStorage.setItem('fallbackChatCounter', chatCounter);
            return `Chat ${chatCounter}`;
        }
    }
    
    // --- Chat Saving Functions ---
    async function saveChatSession() {
        if (chatHistory.length > 0) {
            let savedChats = [];
            try {
                savedChats = JSON.parse(localStorage.getItem('savedChats')) || [];
            } catch (e) {
                savedChats = [];
            }
            // Preserve the unread flag if it exists.
            let nameToUse = currentChatName || chatTitle.textContent.trim() || "Untitled Chat";
            let chatCounter = parseInt(localStorage.getItem('chatCounter') || "0", 10);
            chatCounter++;
            localStorage.setItem('chatCounter', chatCounter);
            let newChat = { id: chatCounter, name: nameToUse, history: chatHistory };
            // If the current chat was marked unread, add that property.
            if (chatHistory.some(msg => msg.role === 'model')) {
                newChat.unread = newChat.unread || false;
            }
            savedChats.push(newChat);
            localStorage.setItem('savedChats', JSON.stringify(savedChats));
            renderSavedChats();
        }
    }
    
    // --- Modify renderSavedChats() to show an unread indicator ---
    function renderSavedChats() {
        const chatListUl = document.querySelector('.chat-list ul');
        if (!chatListUl) return;
        chatListUl.innerHTML = "";
        let savedChats = [];
        try {
            savedChats = JSON.parse(localStorage.getItem('savedChats')) || [];
        } catch (e) {
            savedChats = [];
        }
        savedChats.forEach(chat => {
            // If chat has unread property true, include a blue bubble indicator.
            const unreadIndicator = chat.unread ? '<span class="unread-indicator"></span>' : '';
            const li = document.createElement('li');
            li.classList.add('saved-chat');
            li.innerHTML = `<i class="far fa-comment-dots"></i><span>${chat.name}</span>${unreadIndicator}<button class="delete-chat-btn" title="Delete Chat"><i class="fas fa-trash-alt"></i></button>`;
            li.addEventListener('click', () => {
                // Mark as read when chat is opened.
                if (chat.unread) {
                    chat.unread = false;
                    saveSavedChats(); // A helper to update saved chats in localStorage.
                }
                loadChatSession(chat.id);
            });
            li.querySelector('.delete-chat-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteChatSession(chat.id);
            });
            chatListUl.appendChild(li);
        });
    }
    
    // Helper to update saved chats after marking as read.
    function saveSavedChats() {
        let savedChats = [];
        try {
            savedChats = JSON.parse(localStorage.getItem('savedChats')) || [];
        } catch (e) {
            savedChats = [];
        }
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
        renderSavedChats();
    }
    
    function loadChatSession(chatId) {
        let savedChats = [];
        try {
            savedChats = JSON.parse(localStorage.getItem('savedChats')) || [];
        } catch (e) {
            savedChats = [];
        }
        const chatSession = savedChats.find(chat => chat.id === chatId);
        if (chatSession) {
            chatHistory = chatSession.history;
            renderChatHistory();
            chatTitle.textContent = chatSession.name;
            activeSession = false;
            currentChatName = chatSession.name;
        }
    }
    
    function deleteChatSession(chatId) {
        let savedChats = [];
        try {
            savedChats = JSON.parse(localStorage.getItem('savedChats')) || [];
        } catch (e) {
            savedChats = [];
        }
        savedChats = savedChats.filter(chat => chat.id !== chatId);
        localStorage.setItem('savedChats', JSON.stringify(savedChats));
        renderSavedChats();
    }
    
    function saveCurrentChatHistory() {
        try {
            localStorage.setItem('currentChatHistory', JSON.stringify(chatHistory));
        } catch (e) {
            console.error("Failed to save chat history to localStorage", e);
        }
    }
    
    function loadSettings() {
        const savedModel = localStorage.getItem('geminiModel');
        const savedInstruction = localStorage.getItem('geminiSystemInstruction');
        const savedHistory = localStorage.getItem('currentChatHistory');
        if (modelSelect && modelSelect.options.length > 0) {
            modelSelect.value = savedModel || defaultConfig.defaultModel || modelSelect.options[0].value;
        } else if (modelSelect) {
            modelSelect.value = savedModel || defaultConfig.defaultModel;
        }
        systemInstructionTextarea.value = savedInstruction || defaultConfig.defaultSystemInstruction;
        try {
            chatHistory = JSON.parse(savedHistory || '[]');
            if (!Array.isArray(chatHistory)) {
                console.warn("Loaded chat history was not an array, resetting.");
                chatHistory = [];
            }
        } catch (e) {
            console.error("Failed to parse saved chat history, resetting.", e);
            chatHistory = [];
        }
        renderChatHistory();
        renderSavedChats();
        updateCurrentModelDisplay();
    }
    
    function saveSettings() {
        localStorage.setItem('geminiModel', modelSelect.value);
        localStorage.setItem('geminiSystemInstruction', systemInstructionTextarea.value);
    }
    
    function renderChatHistory() {
        chatBox.innerHTML = '';
        const fragment = document.createDocumentFragment();
        chatHistory.forEach(msg => {
            const messageElements = appendMessageToFragment(fragment, msg.role, msg.text);
            enhanceCodeBlocksInElement(messageElements.content);
            if (typeof Prism !== 'undefined' && typeof Prism.highlightAllUnder === 'function') {
                Prism.highlightAllUnder(messageElements.content);
            }
        });
        chatBox.appendChild(fragment);
        chatBox.classList.add('fade-in');
        setTimeout(() => chatBox.classList.remove('fade-in'), 600);
        updateConversationModeVisibility();
        scrollToBottom();
    }
    
    function appendMessageToFragment(fragment, role, text) {
        let messageType = role.toLowerCase();
        let iconClass = (messageType === 'user') ? 'fa-user' : 'fa-robot';
        if (text.startsWith('[')) {
            messageType = 'error';
            iconClass = 'fa-exclamation-triangle';
        }
        const messageContainer = document.createElement('div');
        messageContainer.classList.add('message', messageType, 'fade-in');
        const iconElement = document.createElement('div');
        iconElement.classList.add('message-icon');
        iconElement.innerHTML = `<i class="fas ${iconClass}"></i>`;
        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');
        const contentHTML = renderMarkdown(text);
        contentElement.innerHTML = contentHTML;
        messageContainer.appendChild(iconElement);
        messageContainer.appendChild(contentElement);
        fragment.appendChild(messageContainer);
        return { container: messageContainer, content: contentElement };
    }
    
    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // --- Cancel Response Button: Abort generation but preserve the last printed AI response ---
    cancelBtn.addEventListener('click', () => {
        if (controller) {
            controller.abort();
        }
        cancelBtn.style.display = "none";
    });
    
    promptGalleryBtn.addEventListener('click', () => openModal('prompt-gallery-modal'));
    settingsBtnHeader.addEventListener('click', () => openModal('settings-modal'));
    settingsBtnGlobal.addEventListener('click', () => openModal('settings-modal'));
    clearChatBtn.addEventListener('click', clearCurrentChat);
    newChatBtn.addEventListener('click', async () => {
        // If there is an active session with a model response, mark it as unread before starting a new chat.
        if (activeSession && chatHistory.some(msg => msg.role === 'model')) {
            chatHistory[chatHistory.length - 1].unread = true;
            await saveChatSession();
        }
        await startNewChat();
    });
    
    document.querySelectorAll('.prompt-item').forEach(button => {
        button.addEventListener('click', () => {
            userInput.value = button.getAttribute('data-prompt');
            closeModal('prompt-gallery-modal');
            userInput.focus();
            adjustTextareaHeight();
        });
    });
    
    modelSelect.addEventListener('change', saveSettings);
    systemInstructionTextarea.addEventListener('input', saveSettings);
    userInput.addEventListener('input', adjustTextareaHeight);
    
    // Abort any ongoing generation if the user refreshes or navigates away.
    window.addEventListener('beforeunload', () => {
        if (controller) controller.abort();
    });
    
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            document.querySelectorAll('.modal.visible').forEach(modal => closeModal(modal.id));
        }
    });
    
    window.openModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('visible');
            document.body.classList.add('modal-open');
        }
    };
    
    window.closeModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('visible');
            if (document.querySelectorAll('.modal.visible').length === 0) {
                document.body.classList.remove('modal-open');
            }
        }
        if (modalId === 'prompt-gallery-modal' || modalId === 'settings-modal') {
            userInput.focus();
        }
    };
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeModal(modal.id);
            }
        });
    });
    
    function adjustTextareaHeight() {
        userInput.style.height = 'auto';
        let scrollHeight = userInput.scrollHeight;
        userInput.style.height = scrollHeight + 'px';
        sendBtn.disabled = !userInput.value.trim();
    }
    
    function scrollToBottom() {
        setTimeout(() => {
            chatBox.scrollTop = chatBox.scrollHeight;
        }, 50);
    }
    
    function updateConversationModeVisibility() {
        if (chatHistory.length > 0 || chatBox.querySelector('.message')) {
            conversationModeSelector.classList.add('hidden');
        } else {
            conversationModeSelector.classList.remove('hidden');
        }
    }
    
    function handleCopyCode(codeElement, button) {
        if (!codeElement || !navigator.clipboard) {
            console.warn("Copy action failed: Code element missing or Clipboard API not supported.");
            return;
        }
        const codeToCopy = codeElement.textContent || "";
        navigator.clipboard.writeText(codeToCopy).then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i> Copied!';
            button.disabled = true;
            setTimeout(() => {
                button.innerHTML = originalText;
                button.disabled = false;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy code: ', err);
            const originalText = button.innerHTML;
            button.textContent = 'Error';
            setTimeout(() => {
                button.innerHTML = originalText;
            }, 2000);
        });
    }
    
    function enhanceCodeBlocksInElement(element) {
        if (!element) return;
        const codeBlocks = element.querySelectorAll('pre > code[class*="language-"], pre > code:not([class])');
        codeBlocks.forEach(codeElement => {
            const preElement = codeElement.parentElement;
            if (!preElement || preElement.tagName !== 'PRE' || preElement.parentElement.classList.contains('code-block-wrapper')) {
                return;
            }
            let language = 'plaintext';
            const langClass = Array.from(codeElement.classList).find(cls => cls.startsWith('language-'));
            if (langClass) {
                language = langClass.replace('language-', '');
                language = language.charAt(0).toUpperCase() + language.slice(1);
            } else {
                codeElement.classList.add('language-plaintext');
                language = 'Plaintext';
            }
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';
            const header = document.createElement('div');
            header.className = 'code-block-header';
            const langSpan = document.createElement('span');
            langSpan.className = 'code-language';
            langSpan.textContent = language;
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-code-btn';
            copyBtn.innerHTML = '<i class="far fa-copy"></i> Copy';
            copyBtn.title = 'Copy code to clipboard';
            copyBtn.addEventListener('click', () => handleCopyCode(codeElement, copyBtn));
            header.appendChild(langSpan);
            header.appendChild(copyBtn);
            wrapper.appendChild(header);
            preElement.parentNode.insertBefore(wrapper, preElement);
            wrapper.appendChild(preElement);
        });
    }
    
    function appendMessage(role, text, addToHistory = true) {
        let messageType = role.toLowerCase();
        let iconClass = messageType === 'user' ? 'fa-user' : 'fa-robot';
        const messageContainer = document.createElement('div');
        messageContainer.classList.add('message', messageType, 'fade-in');
        const iconElement = document.createElement('div');
        iconElement.classList.add('message-icon');
        iconElement.innerHTML = `<i class="fas ${iconClass}"></i>`;
        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');
        const contentHTML = renderMarkdown(text);
        contentElement.innerHTML = contentHTML;
        if (text.startsWith('[Error') || text.startsWith('[Content Blocked') ||
            text.startsWith('[Prompt Blocked') || text.startsWith('[API') ||
            text.startsWith('[Internal Error') || text.startsWith('[Stream Error')) {
            messageType = 'error';
            iconClass = 'fa-exclamation-triangle';
            messageContainer.classList.remove('ai', 'user');
            messageContainer.classList.add('error');
            iconElement.innerHTML = `<i class="fas ${iconClass}"></i>`;
        }
        messageContainer.appendChild(iconElement);
        messageContainer.appendChild(contentElement);
        chatBox.appendChild(messageContainer);
        if (addToHistory && messageType !== 'error') {
            const lastHistMsg = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
            if (!lastHistMsg || !(lastHistMsg.role === (role.toLowerCase() === 'ai' ? 'model' : 'user') && lastHistMsg.text === text)) {
                chatHistory.push({ role: role.toLowerCase() === 'ai' ? 'model' : 'user', text: text });
                saveCurrentChatHistory();
            }
        }
        updateConversationModeVisibility();
        scrollToBottom();
        return { container: messageContainer, content: contentElement };
    }
    
    function showTypingIndicator() {
        removeTypingIndicator();
        const typingRefs = appendMessageToFragment(document.createDocumentFragment(), 'ai', '<span class="typing-indicator"><span></span><span></span><span></span></span>');
        currentAIMessageContainer = typingRefs.container;
        currentAIMessageContainer.id = 'typing-indicator';
        currentAIResponseElement = typingRefs.content;
        chatBox.appendChild(currentAIMessageContainer);
        scrollToBottom();
    }
    
    function removeTypingIndicator() {
        const typingElement = document.getElementById('typing-indicator');
        if (typingElement) {
            // Clear its id so that the final printed response remains visible.
            typingElement.id = "";
        }
        currentAIMessageContainer = null;
        currentAIResponseElement = null;
    }
    
    async function startNewChat(showConfirmation = false) {
        async function proceedWithNewChat() {
            console.log("Starting new chat...");
            // If there's an active session with a model response, mark it as unread.
            if (activeSession && chatHistory.some(msg => msg.role === 'model')) {
                chatHistory[chatHistory.length - 1].unread = true;
                await saveChatSession();
            }
            // Now abort any ongoing generation and clear the active session.
            if (controller) controller.abort();
            chatHistory = [];
            saveCurrentChatHistory();
            chatBox.innerHTML = '';
            chatBox.classList.add('fade-in');
            setTimeout(() => chatBox.classList.remove('fade-in'), 600);
            userInput.value = '';
            adjustTextareaHeight();
            updateConversationModeVisibility();
            chatTitle.textContent = "";
            activeSession = true;
            currentChatName = "";
            removeTypingIndicator();
            currentAIResponseElement = null;
            currentAIMessageContainer = null;
            sendBtn.disabled = true;
            userInput.focus();
        }
        if (showConfirmation && chatHistory.length > 0) {
            if (confirm("Are you sure you want to start a new chat? The current conversation will be saved.")) {
                await proceedWithNewChat();
            }
        } else {
            await proceedWithNewChat();
        }
    }
    
    function clearCurrentChat() {
        startNewChat(true);
    }
    
    async function sendMessage() {
        const prompt = userInput.value.trim();
        if (!prompt || sendBtn.disabled) return;
        if (controller) controller.abort();
        appendMessage('user', prompt, true);
        userInput.value = '';
        adjustTextareaHeight();
        sendBtn.disabled = true;
        cancelBtn.style.display = "inline-flex"; // Show cancel button when generation begins.
        showTypingIndicator();
        controller = new AbortController();
        const signal = controller.signal;
        const historyForAPI = chatHistory.slice(0, -1);
        const requestData = {
            prompt: prompt,
            history: historyForAPI,
            system_instruction: systemInstructionTextarea.value,
            model: modelSelect.value
        };
        let accumulatedResponse = "";
        let currentStreamedHTML = "";
        let streamingMessageContainer = currentAIMessageContainer;
        let streamingContentElement = currentAIResponseElement;
        // Ensure the active chat has a model entry for updating (even if empty).
        if (!chatHistory.length || chatHistory[chatHistory.length - 1].role !== 'model') {
            chatHistory.push({ role: 'model', text: "" });
            saveCurrentChatHistory();
        }
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify(requestData),
                signal: signal
            });
            if (!response.ok) {
                let errorText = `Error: ${response.status} - ${response.statusText}`;
                try {
                    const errorJson = await response.json();
                    errorText = `Error: ${response.status} - ${errorJson.error || response.statusText}`;
                } catch (e) {}
                throw new Error(errorText);
            }
            if (!response.body) throw new Error("Response body is missing.");
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                console.log("Chunk received:", value);
                if (done) {
                    if (buffer) {
                        accumulatedResponse += buffer;
                        buffer = "";
                    }
                    console.log("Stream finished. Final accumulated length:", accumulatedResponse.length);
                    break;
                }
                buffer += value;
                const lines = buffer.split('\n');
                buffer = lines.pop();
                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        const jsonData = line.substring(6).trim();
                        if (jsonData) {
                            try {
                                const chunk = JSON.parse(jsonData);
                                accumulatedResponse += chunk;
                            } catch (e) {
                                console.error("Failed to parse JSON chunk:", jsonData, e);
                                accumulatedResponse += jsonData;
                            }
                        }
                    }
                });
                console.log("Accumulated length so far:", accumulatedResponse.length);
                currentStreamedHTML = renderMarkdown(accumulatedResponse);
                if (streamingContentElement) {
                    streamingContentElement.innerHTML = currentStreamedHTML;
                    scrollToBottom();
                }
                // Update the model message in chatHistory
                if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'model') {
                    chatHistory[chatHistory.length - 1].text = accumulatedResponse;
                    saveCurrentChatHistory();
                }
            }
            if (accumulatedResponse && streamingMessageContainer && streamingContentElement) {
                streamingContentElement.innerHTML = renderMarkdown(accumulatedResponse);
                enhanceCodeBlocksInElement(streamingContentElement);
                if (typeof Prism !== 'undefined' && typeof Prism.highlightAllUnder === 'function') {
                    Prism.highlightAllUnder(streamingContentElement);
                }
            }
            // Ensure the final AI response is stored.
            if (accumulatedResponse) {
                const lastMsg = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
                if (!lastMsg || !(lastMsg.role === 'model' && lastMsg.text === accumulatedResponse)) {
                    chatHistory.push({ role: 'model', text: accumulatedResponse });
                    saveCurrentChatHistory();
                }
            }
            // Chat titler: if active, generate title once.
            if (activeSession && chatHistory.some(msg => msg.role === 'model')) {
                if (!currentChatName) {
                    currentChatName = await getChatName(chatHistory);
                    typeOut(chatTitle, currentChatName, 100);
                } else {
                    chatTitle.textContent = currentChatName;
                }
                await saveChatSession();
                activeSession = false;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Fetch aborted.');
                if (currentAIMessageContainer && currentAIMessageContainer.id === 'typing-indicator') {
                    currentAIMessageContainer.id = "";
                }
            } else {
                console.error("Error sending/receiving message:", error);
                if (currentAIMessageContainer && currentAIMessageContainer.id === 'typing-indicator') {
                    currentAIMessageContainer.id = "";
                }
                appendMessage('error', `${error.message || 'An unknown error occurred.'}`, false);
            }
        } finally {
            streamingMessageContainer = null;
            streamingContentElement = null;
            if (currentAIMessageContainer && currentAIMessageContainer.id === 'typing-indicator') {
                currentAIMessageContainer.id = "";
            }
            currentAIMessageContainer = null;
            currentAIResponseElement = null;
            controller = null;
            cancelBtn.style.display = "none";
            sendBtn.disabled = !userInput.value.trim();
            if (!sendBtn.disabled) {
                userInput.focus();
            }
        }
    }
    
    // --- Initial Setup ---
    loadSettings();
    adjustTextareaHeight();
    updateConversationModeVisibility();
    userInput.focus();
    
    // Abort generation if the user refreshes or navigates away.
    window.addEventListener('beforeunload', () => {
        if (controller) controller.abort();
    });
});
