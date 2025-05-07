import React, { useEffect, useState } from 'react';
import { createRRuleWithStartDate, getChoreAssignmentGridFromChore, toUTCDate } from '@/lib/chore-utils';

const ChoreCalendarView: React.FC<{ chore: any }> = ({ chore }) => {
  const [dateAssignments, setDateAssignments] = useState<any>({});
  const [dates, setDates] = useState<Date[]>([]);
  const [months, setMonths] = useState<{ key: string; monthName: string; dates: Date[]; colStart: number; colEnd: number }[]>([]);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      // Generate date range for the next 3 months
      const startDate = toUTCDate(new Date());
      const endDate = toUTCDate(new Date());
      endDate.setUTCMonth(endDate.getUTCMonth() + 3);

      // Ensure chore.startDate is a UTC Date object
      const choreStartDate = toUTCDate(chore.startDate);

      // Get assignments from the chore object
      const assignments = await getChoreAssignmentGridFromChore(chore, choreStartDate, endDate);

      setDateAssignments(assignments);

      // Generate dates array
      const datesArray = [];
      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        datesArray.push(toUTCDate(currentDate));
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
      setDates(datesArray);

      // Group dates into months
      const monthMap = new Map<string, { key: string; monthName: string; dates: Date[]; colStart: number; colEnd: number }>();
      let colIndex = 2; // Start from 2 to account for the "Name" column
      datesArray.forEach(date => {
        const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
        let month = monthMap.get(monthKey);
        if (!month) {
          month = {
            key: monthKey,
            monthName: date.toLocaleString('default', { month: 'short' }),
            dates: [],
            colStart: colIndex,
            colEnd: colIndex,
          };
          monthMap.set(monthKey, month);
        }
        month.dates.push(date);
        month.colEnd = colIndex;
        colIndex++;
      });
      const months = Array.from(monthMap.values());
      setMonths(months);

      // Get family members
      const familyMembersArray = (chore.assignments && chore.assignments.length > 0)
        ? chore.assignments
            .filter(a => a && a.familyMember)
            .map((a: any) => {
              return a.familyMember;
            })
        : (chore.assignees || []).filter(Boolean);
      
      setFamilyMembers(familyMembersArray);
    };

    fetchData();
  }, [chore]);


  return (
    <div className="overflow-x-auto">
      <table className="w-full table-auto divide-y divide-gray-200 relative">
        <thead className="bg-gray-50">
          <tr>
            <th
              className="px-2 py-1 text-left bg-gray-100 sticky left-0 z-20"
              rowSpan={2}
            >
              Name
            </th>
            {months.map(month => (
              <th
                key={month.key}
                className="px-1 py-1 bg-gray-100 min-w-[2rem] relative"
                colSpan={month.dates.length}
              >
                <div
                  className="text-xs font-semibold text-left bg-gray-100"
                  style={{
                    position: 'sticky',
                    left: '0',
                    minWidth: 'fit-content',
                    zIndex: 10,
                  }}
                >
                  {month.monthName}
                </div>
              </th>
            ))}
          </tr>
          <tr>
            {dates.map(date => (
              <th key={date.toISOString()} className="px-1 py-1 text-center bg-gray-100 min-w-[2rem]">
                <div className="text-sm">{date.getDate()}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {familyMembers.map((member, index) => {
            return (
              <tr key={member?.id || `unknown-${index}`}>
                <td className="px-2 py-1 bg-gray-50 sticky left-0 z-10 whitespace-nowrap">
                  {member?.name || `Unknown Member ${index + 1}`}
                </td>
                {dates.map(date => {
                  const dateStr = date.toISOString().split('T')[0];
                  const assignment = dateAssignments[dateStr] && dateAssignments[dateStr][member.id];

                  return (
                    <td key={date.toISOString()} className="px-1 py-1 text-center">
                      {assignment && assignment.assigned ? (
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            assignment.completed ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        ></span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ChoreCalendarView;