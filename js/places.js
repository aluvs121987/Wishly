/* Wishly place records.
 *
 * Every record below is DEMO data: a fictional place made up for the
 * prototype. Demo facts are never treated as confirmed. Prices, pet policies
 * and access facts on demo records can only put a place into "Ask before
 * choosing" or rule it out (a demo "no" is respected); they can never make a
 * place "Confirmed suitable".
 *
 * Real records (status "sourced" or "verified") need a source and a check date
 * for every fact they claim. With the Wishly server connected, records come
 * from the `places` table and admins add evidence there (see SETUP.md).
 *
 * Record shape (all fields optional unless noted):
 *   id, status ("demo"|"sourced"|"verified"), name {en, ar}, cat, kind, area,
 *   address {en, ar}, coords {lat, lng, source, checked}   venue-specific only
 *   price {amount, basis: per_person|per_booking|per_item|per_visit}
 *   includes {transport, taxes: included|excluded|unknown}
 *   pets {policy: allowed|not_allowed|unknown, types[], restrictions {en, ar}, source, checked}
 *   wheelchair {stepFree, ramp, interior, groundFloor, lift, toilet, restrictions {en, ar}}
 *   accessSource, accessChecked, access[] (feature ids)
 *   contacts {phone, whatsapp, sms, website, menu, social [{label, url}], mapUrl}
 *   contactsSource, contactsChecked
 *   availability {en, ar, checked}, bankOffers [{bank, en, ar, source, checked}]
 *   providerRating {value, count, source}, tags[], note {en, ar}
 */
(function (W) {
  "use strict";
  const demo = (o) => Object.assign({
    status: "demo", coords: null, address: null, contacts: {}, bankOffers: [],
    includes: { transport: "excluded", taxes: "unknown" },
    pets: { policy: "unknown", types: [] }, wheelchair: {}, accessSource: null,
    availability: null, providerRating: null, note: null
  }, o);

  W.AREAS = ["New Cairo", "Heliopolis", "Nasr City", "Maadi", "Zamalek", "Downtown", "Garden City",
    "Giza", "Al-Azhar", "6th of October", "Sheikh Zayed", "Ain Sokhna", "Fayoum"];
  W.AREA_AR = {
    "New Cairo": "القاهرة الجديدة", "Heliopolis": "مصر الجديدة", "Nasr City": "مدينة نصر", "Maadi": "المعادي",
    "Zamalek": "الزمالك", "Downtown": "وسط البلد", "Garden City": "جاردن سيتي", "Giza": "الجيزة",
    "Al-Azhar": "الأزهر", "6th of October": "السادس من أكتوبر", "Sheikh Zayed": "الشيخ زايد",
    "Ain Sokhna": "العين السخنة", "Fayoum": "الفيوم", "Delivered": "توصيل للمنزل", "Comes to you": "يأتي إليك"
  };
  /* District centres are only used for rough travel-time estimates between
     areas. They are never shown as a venue location or used for radius search. */
  W.AREA_CENTRES = {
    "6th of October": [29.94, 30.92], "Zamalek": [30.0609, 31.2197], "Garden City": [30.036, 31.2318],
    "Heliopolis": [30.0911, 31.3225], "New Cairo": [30.03, 31.47], "Maadi": [29.9602, 31.2569],
    "Al-Azhar": [30.0408, 31.2645], "Giza": [29.994, 31.119], "Downtown": [30.0444, 31.2357],
    "Sheikh Zayed": [30.04, 30.99], "Ain Sokhna": [29.6, 32.32], "Fayoum": [29.27, 30.41], "Nasr City": [30.0566, 31.3301]
  };

  W.DEMO_PLACES = [
    demo({ id: "c1", name: { en: "Garden Courtyard Café", ar: "كافيه فناء الحديقة" }, cat: "Food", kind: "cafe", area: "Zamalek",
      price: { amount: 250, basis: "per_person" }, tags: ["quiet", "value", "relax", "romantic"],
      pets: { policy: "allowed", types: ["dog", "cat"] }, wheelchair: { stepFree: true, toilet: true },
      access: ["stepfree", "wc", "braille", "text", "quiet"] }),
    demo({ id: "c2", name: { en: "Nile Rooftop Dinner", ar: "عشاء على سطح النيل" }, cat: "Food", kind: "restaurant", area: "Garden City",
      price: { amount: 750, basis: "per_person" }, tags: ["romantic", "celebrate"], access: ["text"] }),
    demo({ id: "c3", name: { en: "Signs & Sips Café", ar: "كافيه إشارات ورشفات" }, cat: "Food", kind: "cafe", area: "Heliopolis",
      price: { amount: 120, basis: "per_person" }, tags: ["value", "social"], wheelchair: { stepFree: true, toilet: true },
      access: ["sign", "stepfree", "text", "wc"], note: { en: "Run by deaf baristas", ar: "يديره باريستا من الصم" } }),
    demo({ id: "c4", name: { en: "Clay Studio Pottery Workshop", ar: "ورشة فخار كلاي ستوديو" }, cat: "Learning", kind: "workshop", area: "New Cairo",
      price: { amount: 600, basis: "per_person" }, tags: ["learn", "quiet", "relax", "creative"], wheelchair: { stepFree: true, toilet: true },
      access: ["stepfree", "sign", "easyread", "quiet", "wc"] }),
    demo({ id: "c5", name: { en: "Sunset Felucca Ride", ar: "رحلة فلوكة الغروب" }, cat: "Experiences", kind: "boat", area: "Maadi",
      price: { amount: 300, basis: "per_person" }, tags: ["outdoor", "relax", "romantic"], pets: { policy: "not_allowed", types: [] },
      wheelchair: { stepFree: false }, access: ["text"], note: { en: "Boarding involves two steps", ar: "الصعود للمركب فيه درجتين" } }),
    demo({ id: "c6", name: { en: "City Park Picnic Lawn", ar: "حديقة المدينة للنزهة" }, cat: "Experiences", kind: "park", area: "Al-Azhar",
      price: { amount: 60, basis: "per_person" }, tags: ["outdoor", "family", "value", "relax"], pets: { policy: "allowed", types: ["dog"] },
      wheelchair: { stepFree: true, toilet: true }, access: ["stepfree", "wc"] }),
    demo({ id: "c7", name: { en: "Heritage Museum Guided Tour", ar: "جولة متحف التراث بمرشد" }, cat: "Experiences", kind: "museum", area: "Giza",
      price: { amount: 400, basis: "per_person" }, tags: ["learn", "family", "culture"], wheelchair: { stepFree: true, toilet: true },
      access: ["stepfree", "wc", "sign", "braille", "audio", "captions"], note: { en: "Wheelchairs available to borrow", ar: "متاح استعارة كراسي متحركة" } }),
    demo({ id: "c8", name: { en: "Calm Day Spa", ar: "سبا كالم داي" }, cat: "Services", kind: "spa", area: "New Cairo",
      price: { amount: 1100, basis: "per_person" }, tags: ["relax", "quiet", "treat"], wheelchair: { stepFree: true, toilet: true },
      access: ["stepfree", "wc", "text", "quiet", "easyread"] }),
    demo({ id: "c9", name: { en: "Reading Lounge & Bookshop", ar: "صالون القراءة ومكتبة الكتب" }, cat: "Shopping", kind: "bookshop", area: "Heliopolis",
      price: { amount: 200, basis: "per_person" }, tags: ["quiet", "value", "learn", "gift"], wheelchair: { stepFree: true, toilet: true },
      access: ["stepfree", "braille", "quiet", "wc"] }),
    demo({ id: "c10", name: { en: "Handmade Gift Market", ar: "سوق الهدايا اليدوية" }, cat: "Shopping", kind: "market", area: "Downtown",
      price: { amount: 450, basis: "per_item" }, tags: ["gift", "celebrate", "creative"], access: ["text"] }),
    demo({ id: "c11", name: { en: "Curated Gift Box Delivery", ar: "توصيل صندوق هدايا مختار" }, cat: "Shopping", kind: "delivery", area: "Delivered",
      price: { amount: 850, basis: "per_item" }, includes: { transport: "unknown", taxes: "unknown" }, tags: ["gift", "celebrate", "personal"],
      access: ["online", "text", "easyread"], comesToYou: true }),
    demo({ id: "c12", name: { en: "Egyptian Home Cooking Class", ar: "درس الطبخ المصري البيتي" }, cat: "Learning", kind: "class", area: "Sheikh Zayed",
      price: { amount: 700, basis: "per_person" }, tags: ["learn", "social", "family"], wheelchair: { stepFree: true },
      access: ["sign", "captions", "easyread", "stepfree"] }),
    demo({ id: "c13", name: { en: "Ain Sokhna Weekend Resort", ar: "منتجع العين السخنة للويك إند" }, cat: "Travel", kind: "resort", area: "Ain Sokhna",
      price: { amount: 2400, basis: "per_person" }, includes: { transport: "unknown", taxes: "unknown" }, tags: ["relax", "romantic", "outdoor", "treat"],
      wheelchair: { stepFree: true, toilet: true }, access: ["stepfree", "wc", "quiet", "text"] }),
    demo({ id: "c14", name: { en: "Fayoum Lakes Day Trip", ar: "رحلة يوم لبحيرات الفيوم" }, cat: "Travel", kind: "daytrip", area: "Fayoum",
      price: { amount: 900, basis: "per_person" }, includes: { transport: "unknown", taxes: "unknown" }, tags: ["outdoor", "family", "adventure"],
      wheelchair: { stepFree: true }, access: ["stepfree", "text"], note: { en: "Van with a ramp on request", ar: "ميكروباص برامب عند الطلب" } }),
    demo({ id: "c15", name: { en: "Home Cleaning Visit", ar: "زيارة تنظيف منزلي" }, cat: "Services", kind: "home_service", area: "Comes to you",
      price: { amount: 550, basis: "per_visit" }, includes: { transport: "unknown", taxes: "unknown" }, tags: ["value", "home"],
      access: ["text", "easyread", "online"], comesToYou: true }),
    demo({ id: "c16", name: { en: "Captioned Cinema Night", ar: "ليلة سينما بترجمة مكتوبة" }, cat: "Experiences", kind: "cinema", area: "Nasr City",
      price: { amount: 180, basis: "per_person" }, tags: ["social", "value", "fun"], wheelchair: { stepFree: true, toilet: true },
      access: ["captions", "stepfree", "wc", "audio"] }),
    demo({ id: "c17", name: { en: "Classic Cuts Barber", ar: "حلاق كلاسيك كتس" }, cat: "Services", kind: "barber", area: "New Cairo",
      price: { amount: 250, basis: "per_visit" }, tags: ["value", "quiet", "grooming", "barber", "haircut", "beard"], wheelchair: { stepFree: true, toilet: true },
      access: ["stepfree", "wc", "text", "quiet", "sign"], note: { en: "Says it takes bookings by WhatsApp (no number on file)", ar: "يقول إنه يقبل الحجز بواتساب (لا يوجد رقم مسجل)" } }),
    demo({ id: "c18", name: { en: "Koshary & Grill House", ar: "بيت الكشري والمشويات" }, cat: "Food", kind: "restaurant", area: "Nasr City",
      price: { amount: 180, basis: "per_person" }, tags: ["value", "family", "social"], wheelchair: { stepFree: true, toilet: true },
      access: ["stepfree", "wc", "easyread"] })
  ];
})(window.W = window.W || {});
