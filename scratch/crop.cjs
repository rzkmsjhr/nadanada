const Jimp = require('jimp');

Jimp.read('nadanada-logo.png').then(img => {
  img.autocrop();
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const max = Math.max(w, h);
  
  new Jimp(max, max, 0x00000000, (err, bg) => {
    bg.composite(img, (max - w)/2, (max - h)/2);
    bg.write('nadanada-logo.png');
    console.log('Squared successfully!');
  });
}).catch(e => {
  console.error("Failed to crop:", e);
});
