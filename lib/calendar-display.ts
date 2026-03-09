import NepaliDate from 'nepali-date-converter';

export const NEPALI_MONTHS_COMMON_ROMAN = [
    'Baisakh',
    'Jeth',
    'Asar',
    'Saun',
    'Bhadau',
    'Asoj',
    'Kattik',
    'Mangsir',
    'Poush',
    'Magh',
    'Phagun',
    'Chait',
] as const;

export const NEPALI_MONTHS_COMMON_DEVANAGARI = [
    'वैशाख',
    'जेठ',
    'असार',
    'साउन',
    'भदौ',
    'असोज',
    'कात्तिक',
    'मंसिर',
    'पुष',
    'माघ',
    'फागुन',
    'चैत',
] as const;

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'] as const;

export const toDevanagariDigits = (value: string | number) =>
    String(value).replace(/\d/g, (digit) => DEVANAGARI_DIGITS[Number(digit)] ?? digit);

export const formatCommonBsMonthLabel = (monthIndex: number) => {
    const devanagari = NEPALI_MONTHS_COMMON_DEVANAGARI[monthIndex] ?? '';
    const roman = NEPALI_MONTHS_COMMON_ROMAN[monthIndex] ?? '';
    return `${devanagari} (${roman})`.trim();
};

export const getBsMonthMeta = (value: Date) => {
    const nepaliDate = new NepaliDate(value);
    return {
        year: nepaliDate.getYear(),
        monthIndex: nepaliDate.getMonth(),
        day: nepaliDate.getDate(),
        dayDevanagari: toDevanagariDigits(nepaliDate.getDate()),
        monthLabel: formatCommonBsMonthLabel(nepaliDate.getMonth()),
        yearDevanagari: toDevanagariDigits(nepaliDate.getYear()),
    };
};
