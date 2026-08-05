import { describe, expect, it } from 'vitest'
import {
  type AssetInput,
  type NetWorthInput,
  type StaleAsset,
  computeNetWorth,
  debtBalance,
} from './networth'

const TODAY = new Date('2026-08-05T00:00:00')

const asset = (over: Partial<AssetInput>): AssetInput => ({
  name: 'أصل',
  kind: 'cash',
  amount: 0,
  isLiquid: true,
  isEmergencyFund: false,
  ...over,
})

const input = (over: Partial<NetWorthInput>): NetWorthInput => ({
  assets: [],
  restrictedFunds: [],
  debts: [],
  monthlyEssentials: 0,
  emergencyMonths: 3,
  today: TODAY,
  ...over,
})

const FULL = input({
  assets: [
    asset({ name: 'نقد', kind: 'cash', amount: 5000 }),
    asset({ name: 'وديعة الطوارئ', kind: 'savings', amount: 9000, isEmergencyFund: true }),
    asset({ name: 'الشقة', kind: 'property', amount: 60000, isLiquid: false }),
  ],
  restrictedFunds: [3000, 2000],
  debts: [{ name: 'قرض السيارة', monthlyAmount: 500, paymentsLeft: 10 }],
  monthlyEssentials: 3000,
  emergencyMonths: 3,
})

describe('صافي الثروة — المسار الكامل', () => {
  const r = computeNetWorth(FULL)

  it('يجمع الأصول ويفصل السائل عن الجامد', () => {
    expect(r.assetsTotal).toBe(74000)
    expect(r.liquidTotal).toBe(14000)
  })

  it('يعدّ صناديق الالتزامات ملكاً', () => {
    expect(r.restrictedTotal).toBe(5000)
    expect(r.ownedTotal).toBe(79000)
  })

  it('لا يعدّ المال المقيّد سيولةً تُصرف', () => {
    expect(r.liquidTotal).toBe(14000)
    expect(r.liquidTotal).toBeLessThan(r.ownedTotal)
  })

  it('يطرح رصيد القسط وحده من الملك', () => {
    expect(r.debtsTotal).toBe(5000)
    expect(r.netWorth).toBe(74000)
    expect(r.isUnderwater).toBe(false)
  })

  it('يرتّب الأنواع تنازلياً', () => {
    expect(r.byKind.map((l) => l.kind)).toEqual(['property', 'savings', 'cash'])
    expect(r.byKind[0]!.total).toBe(60000)
    expect(r.byKind[0]!.count).toBe(1)
  })
})

describe('التعاريف — قلب هذا الملف', () => {
  /**
   * ما لم يُجمع من الالتزام مصروفٌ آتٍ لا دَين. المحرّك لا يقبله مدخلاً
   * أصلاً، والاختبار يثبّت النتيجة: الصندوق يرفع الملك بمقداره تماماً.
   */
  it('رصيد صندوق الالتزام يرفع الملك ولا يقابله دين', () => {
    const withFund = computeNetWorth(input({ restrictedFunds: [4000] }))
    const without = computeNetWorth(input({}))
    expect(withFund.netWorth - without.netWorth).toBe(4000)
    expect(withFund.debtsTotal).toBe(0)
  })

  it('القسط المنتهي لا رصيد له فلا يُثقل الميزانية', () => {
    const r = computeNetWorth(
      input({ debts: [{ name: 'قسط انتهى', monthlyAmount: 700, paymentsLeft: 0 }] }),
    )
    expect(r.debtsTotal).toBe(0)
    expect(r.netWorth).toBe(0)
  })

  it('صافٍ سالب يبقى سالباً ولا يُقصّ', () => {
    const r = computeNetWorth(
      input({
        assets: [asset({ amount: 1000 })],
        debts: [{ name: 'قرض', monthlyAmount: 400, paymentsLeft: 12 }],
      }),
    )
    expect(r.debtsTotal).toBe(4800)
    expect(r.netWorth).toBe(-3800)
    expect(r.isUnderwater).toBe(true)
  })
})

describe('رصيد الدَّين', () => {
  it('يضرب حصّتي الشهرية في الدفعات المتبقية', () => {
    expect(debtBalance({ name: 'قرض', monthlyAmount: 812.5, paymentsLeft: 8 })).toBe(6500)
  })

  it('يقصّ الأرقام السالبة دفاعياً', () => {
    expect(debtBalance({ name: 'خطأ', monthlyAmount: -500, paymentsLeft: 10 })).toBe(0)
    expect(debtBalance({ name: 'خطأ', monthlyAmount: 500, paymentsLeft: -10 })).toBe(0)
  })
})

describe('صندوق الطوارئ', () => {
  it('يستبعد الصندوق غير السائل لأنه تناقض', () => {
    const r = computeNetWorth(
      input({
        assets: [
          asset({ name: 'ذهب محبوس', amount: 20000, isLiquid: false, isEmergencyFund: true }),
        ],
        monthlyEssentials: 2000,
        emergencyMonths: 3,
      }),
    )
    expect(r.emergencyFund.current).toBe(0)
    expect(r.emergencyFund.target).toBe(6000)
    expect(r.emergencyFund.progress).toBe(0)
    expect(r.emergencyFund.isFunded).toBe(false)
    // الأصل يبقى في الملك وإن خرج من الصندوق.
    expect(r.assetsTotal).toBe(20000)
  })

  it('يحسب كم شهراً يغطّيه الموجود فعلاً', () => {
    const r = computeNetWorth(
      input({
        assets: [asset({ amount: 4500, isEmergencyFund: true })],
        monthlyEssentials: 1500,
        emergencyMonths: 4,
      }),
    )
    expect(r.emergencyFund.monthsCovered).toBe(3)
    expect(r.emergencyFund.target).toBe(6000)
    expect(r.emergencyFund.progress).toBe(0.75)
    expect(r.emergencyFund.isFunded).toBe(false)
  })

  it('مصروف أساسي صفر: هدفٌ صفر واكتفاءٌ بحكم التعريف بلا قسمة على صفر', () => {
    const r = computeNetWorth(
      input({
        assets: [asset({ amount: 800, isEmergencyFund: true })],
        monthlyEssentials: 0,
        emergencyMonths: 6,
      }),
    )
    expect(r.emergencyFund.target).toBe(0)
    expect(r.emergencyFund.monthsCovered).toBe(0)
    expect(r.emergencyFund.progress).toBe(1)
    expect(r.emergencyFund.isFunded).toBe(true)
    expect(Number.isFinite(r.emergencyFund.monthsCovered)).toBe(true)
  })

  it('لا يتجاوز التقدّم واحداً حين يفيض الصندوق', () => {
    const r = computeNetWorth(
      input({
        assets: [asset({ amount: 12000, isEmergencyFund: true })],
        monthlyEssentials: 3000,
        emergencyMonths: 3,
      }),
    )
    expect(r.emergencyFund.progress).toBe(1)
    expect(r.emergencyFund.monthsCovered).toBe(4)
    expect(r.emergencyFund.isFunded).toBe(true)
  })
})

describe('حصص الأنواع', () => {
  it('الحصّة كسرٌ من واحد لا نسبة مئوية', () => {
    const r = computeNetWorth(input({ assets: [asset({ amount: 2500 })] }))
    expect(r.byKind[0]!.share).toBe(1)
  })

  it('تجتمع الحصص على واحد', () => {
    const r = computeNetWorth(FULL)
    const sum = r.byKind.reduce((s, l) => s + l.share, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('يجمع أصول النوع الواحد في سطر واحد', () => {
    const r = computeNetWorth(
      input({
        assets: [
          asset({ name: 'محفظة', kind: 'investment', amount: 7000 }),
          asset({ name: 'أسهم', kind: 'investment', amount: 3000 }),
        ],
      }),
    )
    expect(r.byKind).toHaveLength(1)
    expect(r.byKind[0]!.total).toBe(10000)
    expect(r.byKind[0]!.count).toBe(2)
    expect(r.byKind[0]!.share).toBe(1)
  })
})

describe('الأصول القديمة', () => {
  const stale = (updatedAt: AssetInput['updatedAt'], name = 'أصل'): AssetInput =>
    asset({ name, amount: 1000, updatedAt })

  it('التاريخ الغائب جهلٌ لا قِدَم', () => {
    const r = computeNetWorth(
      input({ assets: [stale(null, 'بلا تاريخ'), stale(undefined, 'بلا حقل')] }),
    )
    expect(r.staleAssets).toEqual([])
  })

  it('ستة شهور بالضبط ليست قديمة — الحدّ مفتوح لا مغلق', () => {
    const r = computeNetWorth(input({ assets: [stale('2026-02-05')] }))
    expect(r.staleAssets).toEqual([])
  })

  it('سبعة شهور تتجاوز الحدّ فتُعلَّم', () => {
    const r = computeNetWorth(input({ assets: [stale('2026-01-05', 'الشقة')] }))
    expect(r.staleAssets).toEqual([{ name: 'الشقة', monthsSinceUpdate: 7 }])
  })

  it('يرتّب الأقدم أولاً', () => {
    const r = computeNetWorth(
      input({
        assets: [
          stale('2026-01-05', 'الأحدث'),
          stale('2024-08-05', 'الأقدم'),
          stale('2025-08-05', 'الأوسط'),
        ],
      }),
    )
    expect(r.staleAssets.map((s) => s.name)).toEqual(['الأقدم', 'الأوسط', 'الأحدث'])
    expect(r.staleAssets.map((s) => s.monthsSinceUpdate)).toEqual([24, 12, 7])
  })

  it('يحترم حدّاً مخصّصاً', () => {
    const r = computeNetWorth(
      input({ assets: [stale('2026-02-05', 'الشقة')], staleAfterMonths: 3 }),
    )
    expect(r.staleAssets).toEqual([{ name: 'الشقة', monthsSinceUpdate: 6 }])
  })

  it('يقرأ الطابع الزمني الكامل كما يقرأ اليوم المجرّد', () => {
    const r = computeNetWorth(input({ assets: [stale('2026-01-05T09:30:00.000Z', 'الشقة')] }))
    expect(r.staleAssets).toEqual([{ name: 'الشقة', monthsSinceUpdate: 7 }])
  })

  /**
   * القائمة الفارغة وحدها لا تُثبت شيئاً — الفراغ يُقرأ نجاحاً.
   *
   * كل حالةٍ من الحالتين التاليتين تنتظر قائمةً فارغة، وحدُّ القِدَم فيهما
   * صفر: أي تاريخٍ مقروءٍ ماضٍ يُعلَّم عنده. فالشاهد الموجب هو ما يجعل
   * الفراغ خبراً: لولاه لمرّت الحالتان حتى لو تعطّل كشف القِدَم كلّه.
   */
  const withThresholdZero = (updatedAt: AssetInput['updatedAt']): StaleAsset[] =>
    computeNetWorth(input({ assets: [stale(updatedAt, 'الشقة')], staleAfterMonths: 0 })).staleAssets

  it('شاهدٌ موجب: عند حدّ الصفر يُعلَّم كل تاريخٍ ماضٍ', () => {
    expect(withThresholdZero('2026-07-05')).toEqual([{ name: 'الشقة', monthsSinceUpdate: 1 }])
  })

  it('تاريخ في المستقبل لا يُنتج عمراً سالباً', () => {
    expect(withThresholdZero('2027-01-05')).toEqual([])
  })

  it('تاريخ غير مقروء يُعامَل كالمجهول', () => {
    expect(withThresholdZero('ليس تاريخاً')).toEqual([])
  })
})

describe('العائد المرجّح', () => {
  it('يرجّح العائد بالمبالغ لا بعدد الأصول', () => {
    const r = computeNetWorth(
      input({
        assets: [
          asset({ amount: 10000, annualReturnPercent: 0 }),
          asset({ kind: 'investment', amount: 30000, annualReturnPercent: 8 }),
        ],
      }),
    )
    expect(r.weightedReturnPercent).toBe(6)
  })

  it('يبقي العائد السالب على سالبه', () => {
    const r = computeNetWorth(
      input({
        assets: [
          asset({ kind: 'investment', amount: 10000, annualReturnPercent: -20 }),
          asset({ kind: 'investment', amount: 30000, annualReturnPercent: 8 }),
        ],
      }),
    )
    expect(r.weightedReturnPercent).toBe(1)
  })

  it('لا يُدخل الصناديق المقيّدة في المقام', () => {
    const r = computeNetWorth(
      input({
        assets: [asset({ kind: 'investment', amount: 10000, annualReturnPercent: 5 })],
        restrictedFunds: [90000],
      }),
    )
    expect(r.weightedReturnPercent).toBe(5)
  })
})

describe('الحالات الحدّية', () => {
  it('لا شيء مسجّل: أصفارٌ نظيفة بلا NaN', () => {
    const r = computeNetWorth(input({}))
    expect(r.assetsTotal).toBe(0)
    expect(r.liquidTotal).toBe(0)
    expect(r.restrictedTotal).toBe(0)
    expect(r.ownedTotal).toBe(0)
    expect(r.debtsTotal).toBe(0)
    expect(r.netWorth).toBe(0)
    expect(r.byKind).toEqual([])
    expect(r.staleAssets).toEqual([])
    expect(r.weightedReturnPercent).toBe(0)
    expect(r.isUnderwater).toBe(false)
    expect(r.emergencyFund).toEqual({
      current: 0,
      target: 0,
      monthsCovered: 0,
      progress: 1,
      isFunded: true,
    })
    for (const value of Object.values(r)) {
      if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false)
    }
  })

  it('يقصّ المبلغ السالب عند الصفر فلا يقلب إشارة الثروة', () => {
    const r = computeNetWorth(
      input({ assets: [asset({ amount: -5000 }), asset({ amount: 1000 })] }),
    )
    expect(r.assetsTotal).toBe(1000)
    expect(r.netWorth).toBe(1000)
  })

  it('يقرّب عند حدّ النتيجة لا داخل التجميع', () => {
    const r = computeNetWorth(
      input({ assets: [asset({ amount: 0.005 }), asset({ amount: 0.005 })] }),
    )
    // 0.005 + 0.005 = 0.01، ولو قُرّب كلٌّ على حدة لصار 0.02.
    expect(r.assetsTotal).toBe(0.01)
  })

  /**
   * مقارنة استدعاءين متطابقين ببعضهما لا تكشف شيئاً — دالّةٌ نقيّة تُعطي
   * الجواب نفسه مرتين حتى لو قرأت الساعة. الدليل أن يتغيّر اليوم المحقون
   * وحده فيتغيّر الجواب معه بالمقدار نفسه.
   */
  it('اليوم المحقون هو مرجع الحساب لا ساعة النظام', () => {
    const one = (today: Date) =>
      computeNetWorth(
        input({ assets: [asset({ amount: 100, updatedAt: '2025-01-01' })], today }),
      ).staleAssets[0]!.monthsSinceUpdate

    expect(one(TODAY)).toBe(19)
    expect(one(new Date('2026-11-05T00:00:00'))).toBe(22)
  })

  /**
   * قرشٌ لا وجود له.
   *
   * دَينان حصّةُ كلٍّ منهما ٠٫٠٠٥ — تقريبُ كلٍّ على حدة يرفع المجموع إلى
   * ٠٫٠٢ فيصير الملكُ والدَّينُ المتساويان دَيناً زائداً، ويلوّن الشاشةَ
   * بالخطر. الجمع خام والتقريب عند الحدّ.
   */
  it('يقرّب مجموع الديون عند الحدّ لا لكل دَينٍ وحده', () => {
    const r = computeNetWorth(
      input({
        debts: [
          { name: 'أ', monthlyAmount: 0.005, paymentsLeft: 1 },
          { name: 'ب', monthlyAmount: 0.005, paymentsLeft: 1 },
        ],
      }),
    )
    expect(r.debtsTotal).toBe(0.01)
  })

  it('ملكٌ يساوي دَيناً: صفرٌ بلا إشارة ولا إنذار غرق', () => {
    const r = computeNetWorth(
      input({
        assets: [asset({ amount: 100.1 }), asset({ amount: 200.2 })],
        debts: [{ name: 'قرض', monthlyAmount: 100.1, paymentsLeft: 3 }],
      }),
    )
    expect(r.netWorth).toBe(0)
    expect(Object.is(r.netWorth, -0)).toBe(false)
    expect(r.isUnderwater).toBe(false)
  })

  it('عائدٌ غير رقميّ لا يُسرّب NaN إلى المتوسط', () => {
    const r = computeNetWorth(
      input({
        assets: [
          asset({ amount: 10000, annualReturnPercent: Number('لا رقم') }),
          asset({ kind: 'investment', amount: 10000, annualReturnPercent: 6 }),
        ],
      }),
    )
    expect(r.weightedReturnPercent).toBe(3)
  })
})
