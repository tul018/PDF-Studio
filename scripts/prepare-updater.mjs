import { writeFileSync } from 'node:fs';
const endpoint=process.env.PDF_STUDIO_UPDATE_URL, pubkey=process.env.PDF_STUDIO_UPDATE_PUBLIC_KEY;
if(!endpoint||!pubkey)throw new Error('Set PDF_STUDIO_UPDATE_URL and PDF_STUDIO_UPDATE_PUBLIC_KEY. Do not put private signing keys in config files.');
if(new URL(endpoint).protocol!=='https:')throw new Error('Update endpoint must use HTTPS.');
writeFileSync('src-tauri/updater.release.json',JSON.stringify({bundle:{createUpdaterArtifacts:true},plugins:{updater:{endpoints:[endpoint],pubkey,windows:{installMode:'passive'}}}},null,2));
console.log('Release updater config prepared. Build with VITE_UPDATES_CONFIGURED=1 and tauri build --config src-tauri/updater.release.json. Signing uses TAURI_SIGNING_PRIVATE_KEY from your release environment.');
