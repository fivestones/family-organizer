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

  return (
    <div className="overflow-x-auto max-w-full">
      <table className="min-w-max divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left bg-gray-100 sticky left-0 z-10">Name</th>
            {dates.map(date => (
              <th key={date.toISOString()} className="px-2 py-1 text-center bg-gray-100">
                {date.getMonth() + 1}/{date.getDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {familyMembers.map(member => (
            <tr key={member.id}>
              <td className="px-2 py-1 bg-gray-50 sticky left-0 z-10">{member.name}</td>
              {dates.map(date => {
                const dateStr = date.toISOString().split('T')[0];
                const assignment = dateAssignments[dateStr] && dateAssignments[dateStr][member.id];

                return (
                  <td key={date.toISOString()} className="px-2 py-1 text-center">
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