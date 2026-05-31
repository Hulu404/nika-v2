// Политика конфиденциальности — рендер из privacy.md

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-[18px] leading-snug text-ink-primary mt-6 mb-2">
      {children}
    </h2>
  );
}

function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[14px] leading-[1.6] text-ink-secondary mt-2 ${className ?? ""}`}>
      {children}
    </p>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-ink-primary">{children}</span>;
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 mb-1 text-[14px] font-medium text-ink-primary">{children}</p>
  );
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mt-1 space-y-1.5">{children}</ul>;
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-[14px] leading-[1.6] text-ink-secondary">
      <span className="mt-[9px] h-[5px] w-[5px] flex-shrink-0 rounded-full bg-ink-faint" />
      <span>{children}</span>
    </li>
  );
}

function TableRow({ cells }: { cells: [React.ReactNode, React.ReactNode] }) {
  return (
    <tr className="border-b border-[var(--border-subtle)] last:border-0">
      <td className="px-3 py-2.5 text-[13px] leading-[1.55] text-ink-secondary">{cells[0]}</td>
      <td className="px-3 py-2.5 text-[13px] leading-[1.55] text-ink-secondary whitespace-nowrap">{cells[1]}</td>
    </tr>
  );
}

interface Props {
  onClose: () => void;
}

export function PrivacyContent({ onClose }: Props) {
  return (
    <div>
      {/* Введение */}
      <p className="text-[14px] leading-[1.6] text-ink-secondary">
        <B>Дата вступления в силу:</B> 1 июня 2026 г.
      </p>
      <P>
        Настоящая Политика конфиденциальности описывает, как ИП Серебряков Дмитрий Сергеевич
        (ИНН 645053987663, далее — «мы», «НИКА») собирает, использует и защищает персональные данные
        пользователей сервиса НИКА (mynika.ru).
      </P>

      {/* 1 */}
      <H2>1. Кто мы</H2>
      <P>Оператор персональных данных:</P>
      <P>
        <B>ИП Серебряков Дмитрий Сергеевич</B><br />
        ИНН: 645053987663<br />
        Адрес: Российская Федерация, г. Саратов<br />
        Email: ceo@mynika.ru
      </P>

      {/* 2 */}
      <H2>2. Какие данные мы собираем</H2>

      <SubLabel>Данные которые вы предоставляете:</SubLabel>
      <Ul>
        <Li>Email-адрес — для входа в аккаунт</Li>
        <Li>Имя — как к вам обращается НИКА (можно вымышленное)</Li>
        <Li>Переписка с НИКОЙ — сообщения которые вы пишете в диалогах</Li>
        <Li>Настройки профиля — тон общения, время уведомлений, цель</Li>
      </Ul>

      <SubLabel>Данные которые собираются автоматически:</SubLabel>
      <Ul>
        <Li>Дата и время входа и активности</Li>
        <Li>
          Данные аналитики поведения в приложении (через Amplitude) — какие экраны открываете,
          как часто пишете. Amplitude не получает содержание ваших сообщений.
        </Li>
      </Ul>

      <SubLabel>Данные которые мы НЕ собираем:</SubLabel>
      <Ul>
        <Li>Геолокация</Li>
        <Li>Данные о здоровье и физических показателях</Li>
        <Li>Платёжные данные (обрабатываются напрямую ЮKassa)</Li>
      </Ul>

      {/* 3 */}
      <H2>3. Зачем мы используем ваши данные</H2>
      <div className="mt-3 overflow-x-auto rounded-[10px] border border-[var(--border-subtle)]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-deep)]">
              <th className="px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                Цель
              </th>
              <th className="px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted whitespace-nowrap">
                Основание
              </th>
            </tr>
          </thead>
          <tbody>
            <TableRow cells={["Обеспечение работы сервиса (вход, диалоги, настройки)", "Исполнение договора"]} />
            <TableRow cells={["Персонализация ответов НИКИ (имя, тон, контекст)", "Исполнение договора"]} />
            <TableRow cells={["Аналитика для улучшения продукта", "Законный интерес"]} />
            <TableRow cells={["Ответы на обращения в поддержку", "Законный интерес"]} />
            <TableRow cells={["Направление уведомлений (если вы их включили)", "Согласие"]} />
          </tbody>
        </table>
      </div>

      {/* 4 */}
      <H2>4. Кому мы передаём данные</H2>
      <P>
        Мы <B>не продаём</B> и <B>не передаём</B> ваши данные рекламодателям
        и третьим лицам в коммерческих целях.
      </P>
      <P>Для работы сервиса мы используем:</P>
      <Ul>
        <Li>
          <B>Supabase</B> (США) — хранение данных аккаунта и диалогов.
          Данные зашифрованы при передаче и хранении.
        </Li>
        <Li>
          <B>Anthropic</B> (США) — языковая модель Claude, которая генерирует ответы НИКИ.
          Ваши сообщения передаются для получения ответа
          и <B>не используются для обучения модели</B> согласно условиям Anthropic.
        </Li>
        <Li>
          <B>Amplitude</B> (США) — продуктовая аналитика.
          Содержание диалогов не передаётся.
        </Li>
        <Li>
          <B>ЮKassa</B> (РФ) — приём платежей.
          Мы не видим и не храним данные карт.
        </Li>
        <Li>
          <B>Vercel</B> (США) — хостинг приложения.
        </Li>
      </Ul>
      <P>
        Все указанные сервисы работают в соответствии с GDPR
        и обеспечивают надлежащий уровень защиты данных.
      </P>

      {/* 5 */}
      <H2>5. Как долго мы храним данные</H2>
      <Ul>
        <Li><B>Данные аккаунта и диалоги</B> — пока вы пользуетесь сервисом или до удаления аккаунта</Li>
        <Li><B>Аналитические данные</B> — до 24 месяцев</Li>
        <Li><B>Данные платежей</B> — в соответствии с требованиями законодательства РФ (5 лет)</Li>
      </Ul>

      {/* 6 */}
      <H2>6. Ваши права</H2>
      <P>Вы имеете право в любой момент:</P>
      <Ul>
        <Li><B>Получить</B> копию своих данных — экспорт диалогов в Профиль → Данные → Экспорт</Li>
        <Li><B>Исправить</B> данные — в разделе Профиль</Li>
        <Li><B>Удалить</B> диалоги — в Профиль → Данные → Удалить все диалоги</Li>
        <Li><B>Удалить аккаунт</B> полностью — в Профиль → Удалить аккаунт</Li>
        <Li>
          <B>Отозвать согласие</B> на уведомления —
          в Профиль → Когда писать первой → Не писать первой
        </Li>
        <Li><B>Обратиться</B> с любым вопросом по данным: ceo@mynika.ru</Li>
      </Ul>
      <P>Мы ответим в течение 30 дней.</P>

      {/* 7 */}
      <H2>7. Возраст пользователей</H2>
      <P>
        Сервис доступен лицам <B>от 14 лет</B>. Если вам нет 14 лет — пожалуйста, не регистрируйтесь.
        Если нам станет известно, что данные были предоставлены лицом младше 14 лет,
        мы удалим такой аккаунт.
      </P>

      {/* 8 */}
      <H2>8. Файлы cookie</H2>
      <P>
        Мы используем только технические cookie — для поддержания сессии авторизации.
        Мы не используем рекламные или отслеживающие cookie.
      </P>

      {/* 9 */}
      <H2>9. Безопасность</H2>
      <Ul>
        <Li>Все соединения защищены протоколом HTTPS</Li>
        <Li>Данные в базе зашифрованы</Li>
        <Li>Доступ к данным пользователей ограничен принципом минимальных привилегий</Li>
      </Ul>

      {/* 10 */}
      <H2>10. Изменения политики</H2>
      <P>
        При существенных изменениях мы уведомим вас по email не позднее чем
        за 7 дней до вступления изменений в силу.
      </P>

      {/* 11 */}
      <H2>11. Контакты</H2>
      <P>
        По всем вопросам, связанным с персональными данными:<br />
        <B>ceo@mynika.ru</B><br />
        ИП Серебряков Дмитрий Сергеевич, г. Саратов, РФ
      </P>

      {/* Кнопка */}
      <button
        onClick={onClose}
        className="mt-8 w-full rounded-pill border border-[var(--border-default)] py-[13px] text-[14px] font-medium text-ink-secondary transition-colors hover:border-[var(--border-strong)] hover:text-ink-primary"
      >
        Закрыть
      </button>
    </div>
  );
}
