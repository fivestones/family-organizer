import React, { useEffect, useState } from 'react';
import { createRRuleWithStartDate, getChoreAssignmentGridFromChore } from '@/lib/chore-utils';

const ChoreCalendarView: React.FC<{ chore: any }> = ({ chore }) => {
  const [dateAssignments, setDateAssignments] = useState<any>({});
  const [dates, setDates] = useState<Date[]>([]);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      // Generate date range for the next 3 months
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 3);

      // Get assignments from the chore object
      const assignments = await getChoreAssignmentGridFromChore(chore, startDate, endDate);

      setDateAssignments(assignments);

      // Generate dates array
      const datesArray = [];
      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        datesArray.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
      setDates(datesArray);

      // Get family members
      setFamilyMembers(chore.assignments ? chore.assignments.map((a: any) => a.familyMember) : chore.assignees);
    };

    fetchData();
  }, [chore]);

  const getMonthName = (date: Date) => {
    return date.toLocaleString('default', { month: 'short' });
  };

  return (
    <div className="overflow-x-auto">
      <table className="table-auto divide-y divide-gray-200">
        <thead className="sticky top-0 bg-white z-10">
          <tr>
          <th className="w-24 px-2 py-1 text-left bg-gray-100 sticky left-0 z-20">Name</th>
            {dates.map((date, index) => (
              <th key={date.toISOString()} className="min-2-[2.5rem] px-1 py-1 text-center bg-gray-100">
                {(index === 0 || date.getDate() === 1) && (
                  <div className="text-xs font-semibold">{getMonthName(date)}</div>
                )}
                <div className="text-sm">{date.getDate()}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {familyMembers.map(member => (
            <tr key={member.id}>
              <td className="w-24 px-2 py-1 bg-gray-50 sticky left-0 z-10 truncate">{member.name}</td>
              {dates.map(date => {
                const dateStr = date.toISOString().split('T')[0];
                const assignment = dateAssignments[dateStr] && dateAssignments[dateStr][member.id];

                return (
                  <td key={date.toISOString()} className="w-10 px-1 py-1 text-center">
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
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ChoreCalendarView;