async function testMix(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`, {
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
  
  try {
    const playlistPanel = data.contents.twoColumnWatchNextResults.playlist.playlist;
    const contents = playlistPanel.contents;
    
    for (let i = 0; i < 5; i++) {
      const item = contents[i].playlistPanelVideoRenderer;
      if (item) {
        console.log("Mix video:", item.title.simpleText, item.videoId);
      }
    }
  } catch(e) {
    console.log("Error parsing mix:", e);
    require('fs').writeFileSync('d:/MAINAN/nadanada/scratch/dump_mix.json', JSON.stringify(data.contents.twoColumnWatchNextResults, null, 2));
  }
}

testMix("dQw4w9WgXcQ");
