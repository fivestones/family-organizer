'use client'

import React, { useState } from 'react';
import FamilyAllowanceView from '@/components/allowance/FamilyAllowanceView';
import { init, tx, id } from '@instantdb/react'


function App() {
 
  return (
    <div>
        <FamilyAllowanceView />
    </div>
  )
}


export default App