import * as cheerio from 'cheerio'

export function extractImgSrc(html: string): string[] {
  const dom = cheerio.load(html)

  const imgSrcs: string[] = []
  dom('img').each((_, elem) => {
    const src = dom(elem).attr('src')
    if (
      src &&
      src.startsWith('https://private-user-images.githubusercontent.com/')
    ) {
      imgSrcs.push(src)
    }
  })
  return imgSrcs
}
