FROM node:18-alpine

# Installation des dépendances système pour la conversion d'images
RUN apk add --no-cache \
    imagemagick \
    imagemagick-dev \
    libraw \
    libraw-dev \
    libraw-tools \
    rawtherapee \
    ffmpeg

# Configuration ImageMagick pour supporter les formats RAW
RUN echo '<policy domain="coder" rights="read|write" pattern="*" />' >> /etc/ImageMagick-7/policy.xml && \
    echo '<policy domain="delegate" rights="read|write" pattern="*" />' >> /etc/ImageMagick-7/policy.xml

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./
RUN npm ci --only=production

# Copie du code source
COPY . .

EXPOSE 3000

CMD ["npm", "start"]