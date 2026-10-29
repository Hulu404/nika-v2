# Билеты /stretch

Один заказ — от 1 до 16 билетов на одно занятие, в том числе в подарок. Цена,
дата, адрес и вместимость — в `lib/clubs/sessions.ts`, браузеру не доверяем.

## Оплата (ЮKassa на сайте)

```
форма /stretch → POST /api/club-signup
  → заказ club_signups + холд мест на 20 минут (pending_payment)
  → платёж ЮKassa (redirect) → страница оплаты ЮKassa
  → возврат на /paid?o=<token>
  → вебхук ЮKassa /api/yookassa/webhook — источник правды: paid / canceled
  → «Открыть бота»: t.me/<бот>?start=st_<token> → «Всё супер, заявка оплачена, приходи»
```

- **Заказ.** `confirm_token` — случайные 32 hex (ключ формы `request_token`),
  он же в `/paid?o=` и в ссылке на бота. Повтор той же формы (тот же ключ или те
  же ник, количество и подарок, пока холд жив) отдаёт тот же платёж.
- **Холд.** `hold_club_seats` под блокировкой на занятие проверяет вместимость и
  держит места 20 минут (`hold_expires_at`). Свободные места = вместимость −
  оплаченные − активные холды (`club_taken_seats`). Раз в минуту
  (`instrumentation.ts` → `lib/clubs/holds-tick.ts`) истёкшие холды → `expired`.
- **Платёж.** `confirmation.type = redirect`, `capture = true`,
  `metadata.order_id` = id заказа, `Idempotence-Key = club-<id>-<попытка>`, чек
  54-ФЗ на почту из формы (`YOOKASSA_RECEIPT=0` — без чека), `return_url` =
  `/paid?o=<token>`.
- **Вебхук.** Из тела берётся только id платежа; статус — `GET /payments/{id}`
  в API ЮKassa. `payment.succeeded` → `confirm_club_payment` в транзакции:
  свой активный холд — `paid`; холд истёк и мест нет — `refunded_overbooked` и
  автоматический возврат через API; заказ уже оплачен другим платежом — возврат
  второго. `payment.canceled` → `canceled`, места свободны. Повторная доставка
  ничего не меняет. Сбой (база, API, возврат) → 500, ЮKassa повторит.
- **/paid.** Статус заказа (оплачено / ждём подтверждения / не оплачено),
  детали занятия, кнопка «Открыть бота». Пока заказ ждёт оплаты, страница
  сверяет статус с API ЮKassa и обновляется сама.
- **Бот** (`lib/telegram/club-signup.ts`), `/start st_<token>`: привязывает
  чат к заказу; оплачено — подтверждение с датой, временем и адресом; ждёт
  оплаты — сверка с ЮKassa, иначе «Ждём подтверждения» и «Проверить ещё раз»;
  отменён или холд истёк — новая ссылка на оплату, если места есть, иначе «мест
  не осталось». Если чат уже привязан, бот сам пишет после вебхука.
- **Старый счёт Telegram** больше не выставляется. Обработчики
  `pre_checkout_query` / `successful_payment` оставлены, чтобы счета,
  отправленные до перехода, можно было оплатить. Как только по заказу создан
  платёж ЮKassa, старый счёт отклоняется (статус уже не `pending`).

Статусы `club_signups.payment_status`: `pending` (форма без оплаты, старый
поток), `pending_payment`, `paid`, `canceled`, `expired`, `refunded_overbooked`,
`refunded`, `waitlist`.

## Подарок и докупка

В режиме «В подарок» покупатель указывает свои контакты и имя получателя, анкета
не нужна. После оплаты бот присылает покупателю отдельное сообщение без цены —
его пересылают получателю и показывают на входе. Номер заказа — `club_signups.id`.

Докупка — кнопка «Уже есть билет? Докупить билеты» и ссылка из бота
(`/stretch?purchase=more#reg`): новый ключ, новый заказ и отдельный платёж,
прежние билеты не меняются.

## Выкладка

1. Применить `supabase/migrations/069_club_yookassa.sql` (после 068).
2. Railway: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`; проверить
   `NEXT_PUBLIC_APP_URL` и `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`
   (`nika_cofferun_signupsbot`, build-time — после смены нужен редеплой).
3. Кабинет ЮKassa → Интеграция → HTTP-уведомления: URL
   `https://www.mynika.online/api/yookassa/webhook`, события `payment.succeeded`,
   `payment.canceled`.
4. Проверка на тестовом магазине: `npx tsx scripts/yookassa-smoke.ts <адрес приложения>`.

Автотесты: `npm test -- lib/clubs lib/yookassa.test.ts lib/telegram/club app/api/yookassa`.
