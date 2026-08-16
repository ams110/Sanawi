import { describe, expect, it } from 'vitest'
import { buildMonthPanel, dailyAllowance, type MonthPanelInput } from './month'

/**
 * قاعدة الأمثلة: شهرٌ وصل فيه 9,000، وخرج منه 2,000 (إيداعات 1,200 وفواتير
 * 800)، وبقي عليه 1,000 أقساطاً وفواتير + 500 ادخاراً.
 *
 *     بإيدك  = 9,000 − 2,000 = 7,000
 *     عليك   = 1,000 +   500 = 1,500
 *     الكفاية= 7,000 − 1,500 = 5,500
 */
const base: MonthPanelInput = {
  receivedIncome: 9000,
  depositsPaid: 1200,
  billsPaid: 800,
  dailyExpenses: 0,
  pendingCommitments: 1000,
  savingsTarget: 500,
  monthlyLoad: 3500,
  daysElapsed: 10,
  daysInMonth: 30,
}

const panel = (over: Partial<MonthPanelInput> = {}) => buildMonthPanel({ ...base, ...over })

describe('buildMonthPanel', () => {
  it('يفصل العالمين: ما خرج فعلاً وما زال على الخطة', () => {
    const p = panel({ dailyExpenses: 1500 })
    expect(p.received).toBe(9000)
    expect(p.paidOut).toBe(3500) // 1200 + 800 + 1500
    expect(p.inHand).toBe(5500)
    expect(p.stillDue).toBe(1500)
    expect(p.coverage).toBe(4000)
    expect(p.isShort).toBe(false)
    expect(p.shortfallCause).toBeNull()
  })

  /*
   * قلب القرار كلّه (خطة docs/income-actual-plan.md): الأساس هو الواصل، لا
   * رقمٌ متوقَّع من `amount × 4.333` لا يصل في أي شهرٍ بعينه.
   */
  it('كل قبضة تصل ترفع الكفاية — الواصل هو الأساس', () => {
    expect(panel({ receivedIncome: 9000 }).coverage).toBe(5500)
    expect(panel({ receivedIncome: 11000 }).coverage).toBe(7500)
    // والمتغيّر الذي كان خارج المتوقَّع صار داخلاً بمجرّد أن يصل.
    expect(panel({ receivedIncome: 9600 }).coverage).toBe(6100)
  })

  /*
   * وهذا هو العطل ش3 وقد قُلب طرفاه معاً.
   *
   * أول الشهر: لم يصل شيء، وخرج قليل، والباقي على الخطة كبير. الرقم سالبٌ
   * صادق — لكن سببه يُسمّى «لسه ما وصلك دخل» لا «تجاوزت بصرفك».
   */
  it('أول الشهر بلا دخل: الأحمر يسمّي سببه لا يتّهم الصرف', () => {
    const p = panel({ receivedIncome: 0, depositsPaid: 0, billsPaid: 0, dailyExpenses: 155 })
    expect(p.inHand).toBe(-155)
    expect(p.coverage).toBe(-1655)
    expect(p.isShort).toBe(true)
    expect(p.shortfallCause).toBe('no_income_yet')
  })

  it('التزاماتٌ أكبر من الواصل: السبب الالتزامات لا الصرف', () => {
    // بصرفٍ صفري تماماً لا يغطّي الواصلُ ما عليك — فالصرف ليس الفاعل.
    const p = panel({
      receivedIncome: 1000,
      depositsPaid: 0,
      billsPaid: 0,
      dailyExpenses: 0,
      pendingCommitments: 3000,
    })
    expect(p.shortfallCause).toBe('commitments')
  })

  it('الصرف هو الفاعل حين يغطّي الواصلُ ما عليك وحده', () => {
    // وصل 3,000 وعليه 1,500 — كان يكفي لولا صرف 2,000.
    const p = panel({
      receivedIncome: 3000,
      depositsPaid: 0,
      billsPaid: 0,
      dailyExpenses: 2000,
    })
    expect(p.coverage).toBe(-500)
    expect(p.shortfallCause).toBe('spending')
  })

  it('لا يقصّ الكفاية عند الصفر: السالب هو الخبر', () => {
    const p = panel({ dailyExpenses: 6000 })
    expect(p.coverage).toBe(-500)
    expect(p.isShort).toBe(true)
  })

  /*
   * الإسقاط يمدّ الصرف وحده — الدخل لا يُسقَط. نفس قرار `forecast.ts`:
   * مواعيد القبض ليست في البيانات، واختراعُ دخلٍ قادم يُسكت التحذير على
   * ثقةٍ مخترَعة.
   */
  it('يُسقط وتيرة الصرف على بقية الشهر ولا يُسقط الدخل', () => {
    // 1,500 في 10 أيام → 4,500 في 30 يوماً.
    const p = panel({ dailyExpenses: 1500 })
    expect(p.projectedExpenses).toBe(4500)
    expect(p.projectedCoverage).toBe(1000) // 9000 − 2000 − 4500 − 1500
    expect(p.projectedIsShort).toBe(false)
  })

  it('الوتيرة قد تُنذر بنقصٍ رغم أن الحالي موجب', () => {
    const p = panel({ dailyExpenses: 2200 })
    expect(p.coverage).toBeGreaterThan(0)
    expect(p.projectedIsShort).toBe(true)
  })

  it('أول يوم في الشهر: لا قسمة على صفر', () => {
    const p = panel({ daysElapsed: 0, dailyExpenses: 300 })
    expect(Number.isFinite(p.projectedCoverage)).toBe(true)
    // 300 في يومٍ واحد → 9,000 في 30 يوماً.
    expect(p.projectedExpenses).toBe(9000)
    expect(p.projectedCoverage).toBe(-3500) // 9000 − 2000 − 9000 − 1500
  })

  it('أيام أكثر من الشهر تُقيَّد فلا يصغر الإسقاط كذباً', () => {
    const a = panel({ daysElapsed: 30, dailyExpenses: 3000 })
    const b = panel({ daysElapsed: 99, dailyExpenses: 3000 })
    expect(a.projectedCoverage).toBe(b.projectedCoverage)
  })

  // بوّابة المدخل الفاسد (قاعدة 6): NaN من الملف الشخصي كان يلوّث كل حقل.
  it('مدخلٌ فاسد لا يسمّم اللوحة', () => {
    const p = panel({
      savingsTarget: Number.NaN,
      pendingCommitments: Number.POSITIVE_INFINITY,
      billsPaid: -300,
    })
    expect(p.stillDue).toBe(0) // كلاهما سقط إلى صفر
    expect(p.paidOut).toBe(1200) // السالب لا يزيد ما بإيدك
    expect(Number.isFinite(p.coverage)).toBe(true)
    expect(Number.isFinite(p.projectedCoverage)).toBe(true)
  })

  it('شهر فارغ تماماً: أصفار لا NaN', () => {
    const p = buildMonthPanel({
      receivedIncome: 0,
      depositsPaid: 0,
      billsPaid: 0,
      dailyExpenses: 0,
      pendingCommitments: 0,
      savingsTarget: 0,
      monthlyLoad: 0,
      daysElapsed: 1,
      daysInMonth: 31,
    })
    expect(p.coverage).toBe(0)
    expect(p.projectedCoverage).toBe(0)
    expect(p.isShort).toBe(false)
    // صفرٌ ليس نقصاً: لا سبب يُسمّى لمن لا نقص عنده.
    expect(p.shortfallCause).toBeNull()
  })

  it('الحمل الشهري يمرّ كما هو للبطاقة العلوية', () => {
    expect(panel().monthlyLoad).toBe(3500)
    expect(panel({ monthlyLoad: Number.NaN }).monthlyLoad).toBe(0)
  })
})

describe('dailyAllowance', () => {
  it('يقسم المتبقي على الأيام الباقية شاملةً اليوم', () => {
    // بقي من الشهر 21 يوماً (30 − 10 + 1).
    expect(dailyAllowance(2100, 10, 30)).toBe(100)
  })

  it('آخر يوم في الشهر: كل المتبقي لليوم', () => {
    expect(dailyAllowance(250, 30, 30)).toBe(250)
  })

  it('لا يعطي مصروفاً سالباً لمن تجاوز', () => {
    expect(dailyAllowance(-500, 10, 30)).toBe(0)
  })

  it('يومٌ خارج الشهر لا يجعل القاسم صفراً', () => {
    expect(Number.isFinite(dailyAllowance(300, 45, 30))).toBe(true)
    expect(dailyAllowance(300, 45, 30)).toBe(300)
  })

  // اليوم صفر كان يعطي قاسماً أكبر من الشهر نفسه (31+1). (ش11)
  it('قبل أول يوم: القاسم أيام الشهر لا أكثر', () => {
    expect(dailyAllowance(310, 0, 31)).toBe(10)
  })
})
