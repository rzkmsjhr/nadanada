const fs = require('fs');

async function test() {
  const url = "https://www.youtube.com/results?search_query=Top+50+trending+music+Indonesia&sp=EgIQAw%3D%3D";
  console.log("Fetching", url);
  const res = await fetch(url, {
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
  fs.writeFileSync('ytData.json', JSON.stringify(data, null, 2));
  
  let contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
  if (!contents) {
    console.log("No contents found in standard path");
    return;
  }
  
  let playlists = 0;
  for (let item of contents) {
    if (item.playlistRenderer) {
      console.log("Playlist Found:", item.playlistRenderer.title.simpleText);
      playlists++;
    } else if (item.lockupViewModel) {
      console.log("Lockup Found:", JSON.stringify(item.lockupViewModel).substring(0, 100));
    }
  }
  console.log("Playlists found:", playlists);
}

test();
