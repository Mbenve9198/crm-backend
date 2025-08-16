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

# Install Google Chrome (raccomandato dalla documentazione OpenWA)
echo "📦 Installazione Google Chrome..."
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get update
apt-get install -y google-chrome-stable

# Fallback: Install Chromium se Chrome fallisce
if [ ! -f "/usr/bin/google-chrome" ]; then
    echo "📦 Google Chrome non installato, fallback a Chromium..."
    apt-get install -y chromium-browser || apt-get install -y chromium
fi

# Create session directory
mkdir -p ./wa-sessions
chmod 777 ./wa-sessions

# Check installation
if [ -f "/usr/bin/google-chrome" ]; then
    echo "✅ Google Chrome installato: /usr/bin/google-chrome"
    echo "🎯 OpenWA userà auto-detection con useChrome: true"
elif [ -f "/usr/bin/chromium-browser" ]; then
    echo "✅ Chromium installato: /usr/bin/chromium-browser"
    echo "🎯 OpenWA userà auto-detection con useChrome: true"
elif [ -f "/usr/bin/chromium" ]; then
    echo "✅ Chromium installato: /usr/bin/chromium"
    echo "🎯 OpenWA userà auto-detection con useChrome: true"
else
    echo "❌ Nessun browser Chrome/Chromium trovato!"
    exit 1
fi

# Install Node.js dependencies
echo "📦 Installazione dipendenze Node.js..."
npm install

echo "🎉 Installazione completata!"
echo "🚀 OpenWA configurato per auto-detection di Chrome" 