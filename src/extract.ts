import {JSDOM} from 'jsdom'

export function extractImgSrc(html: string): string[] {
  const dom = new JSDOM(html)
  const document = dom.window.document
  const imgElements = document.querySelectorAll('img')
  const imgSrcs: string[] = []

  imgElements.forEach(img => {
    const src = img.getAttribute('src')
    if (src) {
      imgSrcs.push(src)
    }
  })

  return imgSrcs
}
