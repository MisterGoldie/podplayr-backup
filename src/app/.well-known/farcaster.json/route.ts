export async function GET() {
  const config = {
    accountAssociation: {
      header: "eyJmaWQiOjEwOTkxNzksInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHg5YmEyMjgwNmNEOEY2NTEzMUU1YWQwMEUwMTdGQjhCMUFlM0EyZmFBIn0",
      payload: "eyJkb21haW4iOiJwb2RwbGF5ci54eXoifQ",
      signature: "MHhkMDVjZjE1NjRiYjZhNWIwMmQ0Nzk2ZjEyNjU3M2UyOTU0OTY4N2IwZjkwMWJlNWJhMjFhOTYyNDY1MzZkMTU4NjM2YWVhZGQzYWI2ZDE1NDIwNDJjOTdiYzY3ZjJiNjcxNjMyYzlmMWUzNTU2YjVlYWE1MjIxYWI3MmMyMGZkNjFj"
    },
    frame: {
      version: "1",
      name: "PODPLAYR",
      iconUrl: "https://podplayr.xyz/icon.png",
      homeUrl: "https://podplayr.xyz",
      imageUrl: "https://podplayr.xyz/image.png",
      buttonTitle: "Enter PODPLAYR",
      splashImageUrl: "https://podplayr.xyz/splash.png",
      splashBackgroundColor: "#000000",
      webhookUrl: "https://podplayr.xyz/api/webhook"
    },
  };

  return Response.json(config);
}