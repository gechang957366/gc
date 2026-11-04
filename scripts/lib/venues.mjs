// 期刊短名：界面徽标用。WoS 导出常是全大写全名，这里统一成惯用缩写。
const VENUE_SHORT = {
  'renewable energy': 'Renew Energy',
  energy: 'Energy',
  'applied energy': 'Appl Energy',
  'energy conversion and management': 'Energy Convers Manag',
  'wind energy': 'Wind Energy',
  'wind energy science': 'Wind Energ Sci',
  'monthly weather review': 'Mon Wea Rev',
  'atmospheric measurement techniques': 'Atmos Meas Tech',
  'geoscientific model development': 'Geosci Model Dev',
  'remote sensing': 'Remote Sens',
  energies: 'Energies',
  forecasting: 'Forecasting',
  'ieee transactions on sustainable energy': 'IEEE TSTE',
  'ieee transactions on smart grid': 'IEEE TSG',
  'ieee transactions on power systems': 'IEEE TPS',
  'ieee transactions on power delivery': 'IEEE TPD',
  'ieee transactions on energy conversion': 'IEEE TEC',
  'ieee transactions on knowledge and data engineering': 'IEEE TKDE',
  'ieee transactions on pattern analysis and machine intelligence': 'IEEE TPAMI',
  'nature communications': 'Nat Commun',
  'nature machine intelligence': 'Nature MI',
  'nature energy': 'Nat Energy',
  'scientific reports': 'Sci Rep',
  'plos one': 'PLOS One',
  'applied sciences': 'Appl Sci',
  'electric power systems research': 'EPSR',
  'international journal of electrical power & energy systems': 'IJEPES',
  'information sciences': 'Inf Sci',
  'unconventional resources': 'Unconv Res',
  'applied energy': 'Appl Energy',
  'renewable energy': 'Renew Energy',
  'energy conversion and management': 'Energy Convers Manag',
  'journal of energy storage': 'J Energy Storage',
  'sustainable energy technologies and assessments': 'SETA',
  'energy reports': 'Energy Rep',
  'protection and control of modern power systems': 'PCMP',
  'power system technology': '电网技术',
  'high voltage engineering': '高电压技术',
  'acta energiae solaris sinica': '太阳能学报',
  'proceedings of the csee': '中国电机工程学报',
  'automation of electric power systems': '电力系统自动化',
  'journal of machine learning research': 'JMLR',
  'advances in atmospheric sciences': 'AAS',
  'journal of renewable and sustainable energy': 'JRSE',
  // 流体/风工程（尾流方向的旗舰刊）
  'journal of fluid mechanics': 'JFM',
  'physics of fluids': 'Phys Fluids',
  'physical review fluids': 'Phys Rev Fluids',
  'journal of wind engineering and industrial aerodynamics': 'JWEIA',
  'journal of fluids and structures': 'JFS',
  'boundary-layer meteorology': 'Bound-Layer Meteor',
  'experiments in fluids': 'Exp Fluids',
  'ocean engineering': 'Ocean Eng',
  'renewable and sustainable energy reviews': 'RSER',
  'applied ocean research': 'Appl Ocean Res',
  'sustainable energy technologies and assessments': 'SETA',
  电力系统自动化: '电力系统自动化',
  中国电机工程学报: '中国电机工程学报',
  中国电力: '中国电力',
  可再生能源: '可再生能源',
  电网技术: '电网技术',
  高电压技术: '高电压技术',
  太阳能学报: '太阳能学报',
}

/** 把期刊全名压成徽标短名（≤ ~18 字符）。 */
export function shortVenue(venue) {
  const raw = String(venue || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const key = raw.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
  if (VENUE_SHORT[key]) return VENUE_SHORT[key]
  // 全大写刊名（WoS 导出风格）→ 首字母缩写
  const letters = raw.replace(/[^A-Za-z\u4e00-\u9fa5]/g, '')
  if (raw === raw.toUpperCase() && /^[A-Z\s&]+$/.test(raw)) {
    const words = raw.split(/\s+/).filter((w) => w && !['ON', 'OF', 'AND', 'THE', 'FOR', 'IN'].includes(w))
    if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 8)
  }
  if (letters.length <= 18) return raw.replace(/\b([A-Z])([A-Z]+)/g, (m, a, b) => a + b.toLowerCase())
  const words = raw.split(/\s+/)
  return words.slice(0, 2).join(' ').slice(0, 18)
}
