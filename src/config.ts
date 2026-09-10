import type { ThemeConfig } from '@/types'

export const themeConfig: ThemeConfig = {
  site: {
    title: 'Yousang',
    subtitle: '엔지니어링 노트',
    description: '백엔드 개발과 시스템 설계, 문제를 해결하며 배운 것을 기록합니다.',
    i18nTitle: false,
    author: 'Yousang',
    url: 'https://yousangson.github.io',
    base: '/',
    favicon: '/icons/favicon.svg',
  },

  color: {
    mode: 'light',
    light: {
      primary: 'oklch(24% 0.018 55)',
      secondary: 'oklch(42% 0.018 55)',
      background: 'oklch(97% 0.018 85)',
      highlight: 'oklch(72% 0.11 55 / 0.28)',
    },
    dark: {
      primary: 'oklch(93% 0.015 80)',
      secondary: 'oklch(78% 0.018 75)',
      background: 'oklch(20% 0.012 55)',
      highlight: 'oklch(72% 0.11 55 / 0.22)',
    },
  },

  global: {
    locale: 'ko',
    moreLocales: [],
    fontStyle: 'sans',
    dateFormat: 'YYYY-MM-DD',
    toc: true,
    katex: false,
    reduceMotion: false,
  },

  comment: {
    enabled: false,
    giscus: {
      repo: '',
      repoId: '',
      category: '',
      categoryId: '',
      mapping: 'pathname',
      strict: '0',
      reactionsEnabled: '1',
      emitMetadata: '0',
      inputPosition: 'bottom',
    },
    twikoo: {
      envId: '',
    },
    waline: {
      serverURL: '',
      emoji: [
        'https://unpkg.com/@waline/emojis@1.2.0/tw-emoji',
      ],
      search: false,
      imageUploader: false,
    },
  },

  seo: {
    twitterID: '',
    verification: {
      google: '',
      bing: '',
      yandex: '',
      baidu: '',
    },
    googleAnalyticsID: '',
    umamiAnalyticsID: '',
    folo: {
      feedID: '',
      userID: '',
    },
    apiflashKey: '',
  },

  footer: {
    links: [
      {
        name: 'RSS',
        url: '/feed.xml',
      },
      {
        name: 'GitHub',
        url: 'https://github.com/YouSangSon',
      },
    ],
    startYear: 2024,
  },

  preload: {
    imageHostURL: '',
    customGoogleAnalyticsJS: '',
    customUmamiAnalyticsJS: '',
  },
}

export const base = themeConfig.site.base === '/' ? '' : themeConfig.site.base.replace(/\/$/, '')
export const defaultLocale = themeConfig.global.locale
export const moreLocales = themeConfig.global.moreLocales
export const allLocales = [defaultLocale, ...moreLocales]
