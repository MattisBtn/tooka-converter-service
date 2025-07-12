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
    
    // IMPORTANT: Ajouter l'extension du fichier source pour que ImageMagick puisse l'identifier
    const sourceExt = this.getFileExtension(imageRecord.source_file_url) || imageRecord.source_format;
    const downloadPath = path.join(tempDir, `${tempId}_source.${sourceExt}`);
    const convertedPath = path.join(tempDir, `${tempId}.${imageRecord.target_format}`);

    try {
      console.log(`Converting ${imageRecord.source_format} to ${imageRecord.target_format}`);
      console.log(`Source file: ${imageRecord.source_file_url}`);

      // 1. Télécharger le fichier source depuis Supabase
      const sourceBuffer = await this.downloadFromSupabase(imageRecord.source_file_url, supabase);
      await fs.writeFile(downloadPath, sourceBuffer);
      console.log(`Downloaded to: ${downloadPath} (${sourceBuffer.length} bytes)`);

      // Vérifier que le fichier existe et a du contenu
      const stats = await fs.stat(downloadPath);
      console.log(`File size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      // 2. Convertir le fichier
      await this.performConversion(downloadPath, convertedPath, imageRecord);

      // 3. Vérifier que la conversion a produit un fichier
      const convertedStats = await fs.stat(convertedPath);
      console.log(`Converted file size: ${convertedStats.size} bytes`);
      
      if (convertedStats.size === 0) {
        throw new Error('Conversion produced empty file');
      }

      // 4. Uploader le fichier converti
      const convertedUrl = await this.uploadToSupabase(
        convertedPath, 
        imageRecord.source_file_url, 
        imageRecord.target_format,
        supabase
      );

      // 5. Mettre à jour la base de données
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

      // 6. Nettoyer les fichiers temporaires
      await this.cleanup([downloadPath, convertedPath]);

      return {
        originalUrl: imageRecord.source_file_url,
        convertedUrl,
        format: `${imageRecord.source_format} → ${imageRecord.target_format}`
      };

    } catch (error) {
      console.error(`Conversion failed for image ${imageRecord.id}:`, error);
      
      // Nettoyer en cas d'erreur
      await this.cleanup([downloadPath, convertedPath]);
      
      // Mettre à jour le statut d'erreur avec plus de détails
      await supabase
        .from('selection_images')
        .update({ 
          conversion_status: 'failed',
          // Optionnel: ajouter une colonne error_message si elle existe
        })
        .eq('id', imageRecord.id);
        
      throw error;
    }
  }

  async downloadFromSupabase(filePath, supabase) {
    try {
      console.log(`Downloading: ${filePath}`);
      
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .download(filePath);

      if (error) {
        throw new Error(`Download failed: ${error.message}`);
      }

      if (!data) {
        throw new Error('No data received from download');
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      console.log(`Download successful: ${buffer.length} bytes`);
      
      return buffer;
    } catch (error) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  async performConversion(inputPath, outputPath, imageRecord) {
    return new Promise((resolve, reject) => {
      const sourceFormat = imageRecord.source_format.toLowerCase();
      const targetFormat = imageRecord.target_format.toLowerCase();

      // Commande de conversion optimisée pour les fichiers RAW
      let command;

      if (['cr2', 'nef', 'arw', 'raf', 'orf', 'dng', 'rw2', 'crw', 'pef', 'srw', 'x3f'].includes(sourceFormat)) {
        // Formats RAW - stratégie différente pour DNG
        if (sourceFormat === 'dng') {
          // Pour DNG, utiliser ImageMagick directement (libraw delegate devrait être configuré)
          command = `magick "${inputPath}" -colorspace sRGB -auto-level -quality 90 -strip "${outputPath}"`;
        } else if (sourceFormat === 'arw') {
          // Paramètres spécifiques pour les fichiers Sony .ARW
          command = `magick "${inputPath}" -colorspace sRGB -auto-level -quality 95 -sampling-factor 4:2:0 "${outputPath}"`;
        } else {
          // Autres formats RAW
          command = `magick "${inputPath}" -colorspace sRGB -auto-level -quality 90 -strip "${outputPath}"`;
        }
      } else if (['heic', 'heif'].includes(sourceFormat)) {
        // Formats HEIC/HEIF
        command = `magick "${inputPath}" -quality 90 "${outputPath}"`;
      } else {
        // Autres formats d'image
        command = `magick "${inputPath}" -quality 90 "${outputPath}"`;
      }

      console.log(`Executing conversion command: ${command}`);

      // Augmenter le timeout pour les fichiers RAW volumineux
      const timeout = ['arw', 'dng'].includes(sourceFormat) ? 180000 : 120000; // 3 minutes pour ARW/DNG, 2 minutes pour autres

      exec(command, { 
        timeout,
        maxBuffer: 1024 * 1024 * 50 // 50MB buffer pour les gros fichiers
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Conversion error for ${sourceFormat}:`, error.message);
          console.error(`Command: ${command}`);
          console.error(`stdout: ${stdout}`);
          console.error(`stderr: ${stderr}`);
          
          // Fallback pour DNG si la première méthode échoue
          if (sourceFormat === 'dng' && command.includes('magick')) {
            console.log('Trying fallback DNG conversion with dcraw_emu...');
            this.performDngFallbackConversion(inputPath, outputPath, imageRecord)
              .then(resolve)
              .catch(reject);
            return;
          }
          
          // Erreurs spécifiques
          if (['arw', 'dng'].includes(sourceFormat) && stderr.includes('no decode delegate')) {
            reject(new Error(`ImageMagick libraw delegate missing for ${sourceFormat.toUpperCase()} files. stderr: ${stderr}`));
          } else if (error.code === 'ETIMEDOUT') {
            reject(new Error(`Conversion timeout (${timeout}ms) for ${sourceFormat} file`));
          } else {
            reject(new Error(`Conversion failed: ${error.message}. stderr: ${stderr}`));
          }
        } else {
          console.log(`Conversion successful for ${sourceFormat}: ${outputPath}`);
          if (stdout) console.log(`stdout: ${stdout}`);
          resolve();
        }
      });
    });
  }

  async performDngFallbackConversion(inputPath, outputPath, imageRecord) {
    return new Promise((resolve, reject) => {
      // Méthode alternative pour DNG : utiliser dcraw_emu pour extraire vers TIFF puis convertir
      const tempTiffPath = inputPath.replace('.dng', '_temp.tiff');
      const command = `dcraw_emu -w -T "${inputPath}" -o 1 && magick "${tempTiffPath}" -colorspace sRGB -auto-level -quality 90 -strip "${outputPath}"`;
      
      console.log(`Executing DNG fallback conversion: ${command}`);
      
      exec(command, { 
        timeout: 180000,
        maxBuffer: 1024 * 1024 * 50
      }, async (error, stdout, stderr) => {
        // Nettoyer le fichier TIFF temporaire
        try {
          await fs.unlink(tempTiffPath);
        } catch (cleanupError) {
          console.warn(`Could not clean up temp TIFF: ${cleanupError.message}`);
        }
        
        if (error) {
          console.error(`DNG fallback conversion failed:`, error.message);
          console.error(`stderr: ${stderr}`);
          reject(new Error(`DNG fallback conversion failed: ${error.message}. stderr: ${stderr}`));
        } else {
          console.log(`DNG fallback conversion successful: ${outputPath}`);
          resolve();
        }
      });
    });
  }

  async uploadToSupabase(filePath, originalPath, targetFormat, supabase) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      console.log(`Uploading converted file: ${fileBuffer.length} bytes`);
      
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

      console.log(`Upload successful: ${newPath}`);
      return newPath;
    } catch (error) {
      throw new Error(`Failed to upload converted file: ${error.message}`);
    }
  }

  getFileExtension(filePath) {
    const parts = filePath.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : null;
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
        console.log(`Cleaned up: ${filePath}`);
      } catch (error) {
        // Ignorer les erreurs de nettoyage
        console.warn(`Could not delete ${filePath}: ${error.message}`);
      }
    }
  }
}

module.exports = new ConversionService();