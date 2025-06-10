export async function GET() {
  const config = {
    accountAssociation: {
      header: "eyJmaWQiOjEwMTQ0ODUsInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHhEQkRCNmVCNUQ5MDE0MTY3NUVCNjdENzk3NDUwMzFlNDY2OGYzZkQyIn0",
      payload: "eyJkb21haW4iOiJwb2RwbGF5ci54eXoifQ",
      signature: "MHgyYTExYTYzNzMxNDBmYjViZDU3MzUwZTc3YWZjYzc4ZTM2NmE3MTdiMjA2MTMwNGY5NDhlYzY0MTAwNzc3YzRkM2VjN2ExYmUwNzFhM2E3NDE2MmUxNzVlMTBjZWE4ODE4MjY2OGI1YTc2ODBjOGI4YTQwZTEwZjc5Y2NkZWU5MTFj"
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