async function testRelated(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  const text = await res.text();
  
  const match = text.match(/var ytInitialData = (\{.*?\});<\/script>/);
  if (!match) {
    console.log("No ytInitialData found");
    return;
  }
  
  const data = JSON.parse(match[1]);
  require('fs').writeFileSync('d:/MAINAN/nadanada/scratch/dump.json', JSON.stringify(data, null, 2));
  console.log("Dump written");
}

testRelated("dQw4w9WgXcQ");
