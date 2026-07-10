require('dotenv').config();

const { Storage } = require('@google-cloud/storage');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GOOGLE_CLOUD_STORAGE_CREDENTIALS,
  GCS_BUCKET_RESORT
} = process.env;

const SUPABASE_BUCKET = 'landing_photos';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase configuration.');
  process.exit(1);
}

if (!GOOGLE_CLOUD_STORAGE_CREDENTIALS) {
  console.error('Missing Google Cloud Storage credentials.');
  process.exit(1);
}

if (!GCS_BUCKET_RESORT) {
  console.error('Missing GCS bucket name.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const storage = new Storage({
  credentials: JSON.parse(GOOGLE_CLOUD_STORAGE_CREDENTIALS),
});
const bucket = storage.bucket(GCS_BUCKET_RESORT);

async function migrateAllFiles() {
  console.log('Starting migration...');

  const { data: files, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .list('', { limit: 1000 });

  if (error) {
    console.error(`Unable to list files: ${error.message}`);
    return;
  }

  console.log(`${files.length} file(s) found.`);

  for (const { name } of files) {
    try {
      console.log(`Processing ${name}...`);

      const { data, error: downloadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .download(name);

      if (downloadError) {
        console.error(`Download failed (${name}): ${downloadError.message}`);
        continue;
      }

      if (!data) {
        console.error(`No data for ${name}`);
        continue;
      }

      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const destinationFile = bucket.file('fotosresort/' + name);
      await destinationFile.save(buffer, { resumable: false });

      console.log(`Uploaded: fotosresort/${name}`);
    } catch (error) {
      console.error(`Unexpected error processing ${name}: ${error.message}`);
    }
  }

  console.log('Migration completed.');
}

migrateAllFiles().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});