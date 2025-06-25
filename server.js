require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const conversionService = require('./services/conversionService');

const app = express();
const port = process.env.PORT || 3000;

// Configuration Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middlewares
app.use(cors());
app.use(express.json());

// Route de santé
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Route principale de conversion
app.post('/convert', async (req, res) => {
  try {
    const { imageIds } = req.body;

    if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ 
        error: 'imageIds array is required and must contain at least one ID' 
      });
    }

    console.log(`Starting conversion for ${imageIds.length} images`);

    // Récupération des informations des images
    const { data: images, error: fetchError } = await supabase
      .from('selection_images')
      .select('*')
      .in('id', imageIds)
      .eq('requires_conversion', true);

    if (fetchError) {
      console.error('Error fetching images:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch images' });
    }

    if (!images || images.length === 0) {
      return res.status(404).json({ error: 'No convertible images found' });
    }

    console.log(`Found ${images.length} images to convert`);

    // Traitement de chaque image
    const results = [];
    for (const image of images) {
      try {
        console.log(`Processing image ${image.id}`);
        
        // Mise à jour du statut à "processing"
        await supabase
          .from('selection_images')
          .update({ conversion_status: 'processing' })
          .eq('id', image.id);

        const result = await conversionService.convertImage(image, supabase);
        results.push({ imageId: image.id, status: 'success', result });

      } catch (error) {
        console.error(`Error converting image ${image.id}:`, error);
        
        // Mise à jour du statut à "failed"
        await supabase
          .from('selection_images')
          .update({ conversion_status: 'failed' })
          .eq('id', image.id);

        results.push({ 
          imageId: image.id, 
          status: 'error', 
          error: error.message 
        });
      }
    }

    res.json({
      message: 'Conversion process completed',
      results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'error').length
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route pour vérifier le statut de conversion
app.get('/status/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;

    const { data: image, error } = await supabase
      .from('selection_images')
      .select('conversion_status, file_url, source_file_url')
      .eq('id', imageId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json({
      imageId,
      status: image.conversion_status,
      sourceUrl: image.source_file_url,
      convertedUrl: image.file_url
    });

  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Conversion API running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});