#!/bin/bash

# 🔧 Script di installazione Chrome per Render
# Usare come Build Command su Render se browserRevision non funziona

echo "🔧 Installazione Chrome per OpenWA su Render..."

# Aggiorna package manager
apt-get update

# Installa dipendenze Chrome
apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils

# Installa Chrome
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get update
apt-get install -y google-chrome-stable

# Verifica installazione
if command -v google-chrome-stable &> /dev/null; then
    echo "✅ Chrome installato: $(google-chrome-stable --version)"
    # Crea symlink per chrome
    ln -sf /usr/bin/google-chrome-stable /tmp/chromium-browser/chrome
    mkdir -p /tmp/chromium-browser
    ln -sf /usr/bin/google-chrome-stable /tmp/chromium-browser/chrome
else
    echo "❌ Errore installazione Chrome"
    exit 1
fi

# Installa dipendenze Node.js
npm install

echo "🚀 Setup completato!" 