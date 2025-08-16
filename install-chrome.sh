#!/bin/bash

# Script per installare Chrome/Chromium su Render
echo "🔧 Installazione Chrome per OpenWA..."

# Update system
apt-get update

# Install required dependencies
apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libgconf-2-4 \
    libxtst6 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxss1 \
    libnss3 \
    libnss3-dev \
    libgconf-2-4 \
    libappindicator1 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils

# Try to install Chromium
echo "📦 Installazione Chromium..."
apt-get install -y chromium-browser || apt-get install -y chromium

# Alternative: Install Google Chrome
if [ ! -f "/usr/bin/chromium-browser" ] && [ ! -f "/usr/bin/chromium" ]; then
    echo "📦 Chromium non trovato, installazione Google Chrome..."
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
    apt-get update
    apt-get install -y google-chrome-stable
fi

# Create session directory
mkdir -p ./wa-sessions
chmod 777 ./wa-sessions

# Check installation
if [ -f "/usr/bin/chromium-browser" ]; then
    echo "✅ Chromium installato: /usr/bin/chromium-browser"
    export CHROME_PATH="/usr/bin/chromium-browser"
    export PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser"
elif [ -f "/usr/bin/chromium" ]; then
    echo "✅ Chromium installato: /usr/bin/chromium"
    export CHROME_PATH="/usr/bin/chromium"
    export PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
elif [ -f "/usr/bin/google-chrome" ]; then
    echo "✅ Google Chrome installato: /usr/bin/google-chrome"
    export CHROME_PATH="/usr/bin/google-chrome"
    export PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome"
else
    echo "❌ Nessun browser Chrome/Chromium trovato!"
    exit 1
fi

# Install Node.js dependencies
echo "📦 Installazione dipendenze Node.js..."
npm install

echo "🎉 Installazione completata!"
echo "Chrome path: $CHROME_PATH" 