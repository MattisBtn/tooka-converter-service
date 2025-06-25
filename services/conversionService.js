const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

class ConversionService {
  constructor() {
    this.bucketName = 'selection-images';
  }

  async convertImage(imageRecord, supabase) {
    const tempId = uuidv4();
    const tempDir = os.tmpdir();
    const downloadPath = path.join(tempDir, `${tempId}_source`);
    const convertedPath = path.join(tempDir, `${tempId}.${imageRecord.target_format}`);

    try {
      console.log(`Converting ${imageRecord.source_format} to ${imageRecord.target_format}`);
      console.log(`Source file: ${imageRecord.source_file_url}`);

      // 1. Télécharger le fichier source depuis Supabase
      const sourceBuffer = await this.downloadFromSupabase(imageRecord.source_file_url, supabase);
      await fs.writeFile(downloadPath, sourceBuffer);
      console.log(`Downloaded to: ${downloadPath}`);

      // 2. Convertir le fichier
      await this.performConversion(downloadPath, convertedPath, imageRecord);

      // 3. Uploader le fichier converti
      const convertedUrl = await this.uploadToSupabase(
        convertedPath, 
        imageRecord.source_file_url, 
        imageRecord.target_format,
        supabase
      );

      // 4. Mettre à jour la base de données
      const { error: updateError } = await supabase
        .from('selection_images')
        .update({
          file_url: convertedUrl,
          conversion_status: 'completed'
        })
        .eq('id', imageRecord.id);

      if (updateError) {
        throw new Error(`Database update failed: ${updateError.message}`);
      }

      // 5. Nettoyer les fichiers temporaires
      await this.cleanup([downloadPath, convertedPath]);

      return {
        originalUrl: imageRecord.source_file_url,
        convertedUrl,
        format: `${imageRecord.source_format} → ${imageRecord.target_format}`
      };

    } catch (error) {
      // Nettoyer en cas d'erreur
      await this.cleanup([downloadPath, convertedPath]);
      throw error;
    }
  }

  async downloadFromSupabase(filePath, supabase) {
    try {
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .download(filePath);

      if (error) {
        throw new Error(`Download failed: ${error.message}`);
      }

      return Buffer.from(await data.arrayBuffer());
    } catch (error) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  async performConversion(inputPath, outputPath, imageRecord) {
    return new Promise((resolve, reject) => {
      const sourceFormat = imageRecord.source_format.toLowerCase();
      const targetFormat = imageRecord.target_format.toLowerCase();

      // Commande de conversion selon le format
      let command;

      if (['cr2', 'nef', 'arw', 'raf', 'orf', 'dng', 'rw2'].includes(sourceFormat)) {
        // Formats RAW - utiliser ImageMagick avec libraw
        command = `magick "${inputPath}" -quality 90 -strip "${outputPath}"`;
      } else if (['heic', 'heif'].includes(sourceFormat)) {
        // Formats HEIC/HEIF
        command = `magick "${inputPath}" -quality 90 "${outputPath}"`;
      } else {
        // Autres formats d'image
        command = `magick "${inputPath}" -quality 90 "${outputPath}"`;
      }

      console.log(`Executing: ${command}`);

      exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Conversion error: ${error.message}`);
          console.error(`stderr: ${stderr}`);
          reject(new Error(`Conversion failed: ${error.message}`));
        } else {
          console.log(`Conversion successful: ${outputPath}`);
          resolve();
        }
      });
    });
  }

  async uploadToSupabase(filePath, originalPath, targetFormat, supabase) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      
      // Générer le nouveau chemin (même dossier, nouveau nom avec format)
      const pathParts = originalPath.split('/');
      const filename = pathParts[pathParts.length - 1];
      const nameWithoutExt = filename.split('.')[0];
      const newFilename = `${nameWithoutExt}_converted.${targetFormat}`;
      
      // Remplacer le nom de fichier dans le chemin original
      pathParts[pathParts.length - 1] = newFilename;
      const newPath = pathParts.join('/');

      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(newPath, fileBuffer, {
          contentType: this.getContentType(targetFormat),
          upsert: true
        });

      if (error) {
        throw new Error(`Upload failed: ${error.message}`);
      }

      return newPath;
    } catch (error) {
      throw new Error(`Failed to upload converted file: ${error.message}`);
    }
  }

  getContentType(format) {
    const contentTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'tiff': 'image/tiff',
      'bmp': 'image/bmp'
    };
    return contentTypes[format.toLowerCase()] || 'image/jpeg';
  }

  async cleanup(filePaths) {
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // Ignorer les erreurs de nettoyage
        console.warn(`Could not delete ${filePath}: ${error.message}`);
      }
    }
  }
}

module.exports = new ConversionService();