FROM node:18-alpine

# Installation des dépendances système pour la conversion d'images
RUN apk add --no-cache \
    imagemagick \
    imagemagick-dev \
    libraw \
    libraw-dev \
    libraw-tools \
    rawtherapee \
    ffmpeg \
    file

# Configuration ImageMagick pour supporter les formats RAW
RUN echo '<policy domain="coder" rights="read|write" pattern="*" />' >> /etc/ImageMagick-7/policy.xml && \
    echo '<policy domain="delegate" rights="read|write" pattern="*" />' >> /etc/ImageMagick-7/policy.xml && \
    echo '<policy domain="resource" name="memory" value="1GB"/>' >> /etc/ImageMagick-7/policy.xml && \
    echo '<policy domain="resource" name="disk" value="2GB"/>' >> /etc/ImageMagick-7/policy.xml

# Vérifier le support des formats RAW et la disponibilité des outils
RUN magick identify -list format | grep -i dng || echo "DNG format check completed" && \
    dcraw_emu --help || echo "dcraw_emu available" && \
    which libraw-tools || echo "libraw-tools installed"

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./
RUN npm ci --only=production

# Copie du code source
COPY . .

EXPOSE $PORT

CMD ["npm", "start"]