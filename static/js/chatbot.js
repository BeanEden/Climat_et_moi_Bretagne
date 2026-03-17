/**
 * chatbot.js — Gère l'interface frontend du widget flottant Mistral
 */
document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("chatbot-toggle-btn");
    const closeBtn = document.getElementById("chatbot-close-btn");
    const container = document.getElementById("mistral-chatbot-container");
    const inputField = document.getElementById("chatbot-input");
    const sendBtn = document.getElementById("chatbot-send-btn");
    const messagesDiv = document.getElementById("chatbot-messages");

    let messagesHistory = []; // Stocke l'historique pour l'API Ollama

    // Ouvre le chat
    toggleBtn.addEventListener("click", () => {
        container.classList.remove("closed");
        toggleBtn.style.display = "none";
        inputField.focus();
    });

    // Ferme le chat
    closeBtn.addEventListener("click", () => {
        container.classList.add("closed");
        toggleBtn.style.display = "flex";
    });

    function appendMessage(role, text) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-message ${role}`;
        
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble";
        bubble.textContent = text;
        
        msgDiv.appendChild(bubble);
        messagesDiv.appendChild(msgDiv);
        
        // Auto scroll en bas
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    async function sendMessage() {
        const text = inputField.value.trim();
        if (!text) return;

        // Affiche la requête côté user
        appendMessage("user", text);
        inputField.value = "";
        
        // Push dans l'historique
        messagesHistory.push({ role: "user", content: text });

        // Ajouter état de chargement visuel
        const loadingId = "loading-" + Date.now();
        const loadingDiv = document.createElement("div");
        loadingDiv.className = `chat-message bot`;
        loadingDiv.id = loadingId;
        loadingDiv.innerHTML = `<div class="chat-bubble" style="opacity:0.6; font-style:italic;">Llama réfléchit...</div>`;
        messagesDiv.appendChild(loadingDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: messagesHistory })
            });
            const data = await response.json();
            
            // Retire le loader
            document.getElementById(loadingId).remove();

            if (data.error) {
                appendMessage("bot", `❌ Erreur : ${data.error}`);
            } else {
                appendMessage("bot", data.response);
                messagesHistory.push({ role: "assistant", content: data.response });
            }
            
        } catch (error) {
            document.getElementById(loadingId).remove();
            appendMessage("bot", "❌ Erreur de réseau.");
        }
    }

    sendBtn.addEventListener("click", sendMessage);
    inputField.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });
});
