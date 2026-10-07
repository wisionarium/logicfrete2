# Logic Frete - Update Cards Script
# This script updates the layout of task cards in app.js

$appPath = "app.js"
if (!(Test-Path $appPath)) {
    Write-Error "Arquivo app.js não encontrado."
    exit
}

# Function to safely replace a block of code
function Update-Block($fileContent, $startMark, $endMark, $newBlock) {
    $pattern = "(?s)$([regex]::Escape($startMark)).+?$([regex]::Escape($endMark))"
    return [regex]::Replace($fileContent, $pattern, $startMark + "`n" + $newBlock + "`n" + $endMark)
}

$app = [System.IO.File]::ReadAllText($appPath, [System.Text.Encoding]::UTF8)

# Correct renderDeliveriesList implementation
$deliveriesCode = @'
      const list = document.getElementById('deliveriesListMain');
      if(!list) return;
      const deliveries = StorageManager.getDeliveries();
      const routes = StorageManager.getRoutes();
      
      const searchInput = document.getElementById('searchDeliveriesMain');
      const q = searchInput ? searchInput.value.toLowerCase() : '';
      let filtered = deliveries;
      if (q) {
        filtered = deliveries.filter(d => 
          d.recipient.toLowerCase().includes(q) || 
          (d.address && d.address.toLowerCase().includes(q))
        );
      }
  
      if (filtered.length === 0) {
        list.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1"><i class="ri-map-pin-line"></i><p>Nenhuma entrega encontrada</p></div>`;
        return;
      }
  
      list.innerHTML = '';
      filtered.forEach(d => {
        const route = routes.find(r => r.id === d.routeId);
        const st = statusMap[d.status] || statusMap['pending'];
  
        const div = document.createElement('div');
        div.className = 'task-card list-item';
        if (d.status === 'delivered') div.classList.add('delivered');
        div.innerHTML = `
          <div class="task-header">
            <div class="task-indicator ${st.class}"></div>
            <div class="task-title">${(d.recipient || 'SEM NOME').toUpperCase()}</div>
          </div>
          <div class="task-body">
            <div class="task-row"><span class="task-label">CLIENTE:</span> <span class="task-value">${d.recipient}</span></div>
            <div class="task-row"><span class="task-label">CPF/CNPJ:</span> <span class="task-value">${d.cpf || '-'}</span></div>
            <div class="task-row"><span class="task-label">TEL:</span> <span class="task-value">${d.phone || '-'}</span></div>
            <div class="task-row"><span class="task-label">END:</span> <span class="task-value">${d.address || '-'}</span></div>
            ${d.notes ? `<div class="task-notes">${d.notes}</div>` : ''}
          </div>
          <div class="task-footer">
            <div class="task-date"><i class="ri-calendar-line"></i> ${route ? formatDate(route.date) : '-'}</div>
            <div class="details-actions">
              ${window.appPermissions?.canEditRoute ? `<button class="btn-icon-xs" onclick="event.stopPropagation(); window.openDeliveryModalFromList('${d.id}')" title="Editar"><i class="ri-edit-line"></i></button>` : ''}
              <button class="btn-icon-xs" onclick="event.stopPropagation(); window.viewOnMap('${d.routeId}')" title="Ver no Mapa"><i class="ri-map-2-line"></i></button>
            </div>
          </div>
        `;
  
        div.addEventListener('click', () => {
          const wasExpanded = div.classList.contains('expanded');
          document.querySelectorAll('.list-item.expanded').forEach(item => item.classList.remove('expanded'));
          if (!wasExpanded) div.classList.add('expanded');
        });
        list.appendChild(div);
      });
'@

# Update the function body
$app = Update-Block $app "function renderDeliveriesList() {" "    }" $deliveriesCode

# Save with UTF8 no BOM
$utf8NoBOM = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($appPath, $app, $utf8NoBOM)
Write-Host "app.js atualizado com sucesso."
